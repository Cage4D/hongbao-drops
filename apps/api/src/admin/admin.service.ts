// Operator endpoints (spec §10.1 rules 5 and 7). Bearer ADMIN_TOKEN.
//
// The server stays non-custodial: it never holds the demo wallet's keys or any link secret. The
// judge-demo envelope is funded by the operator (frontend / wallet) and then *registered* here;
// refills are one at a time — a new demo envelope is only accepted once the current one is used up.
import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceService } from '../price/price.service.js';
import { AppError } from '../common/app-error.js';
import { validate } from '../common/validate.js';
import { toNum } from '../common/bigint.js';

const DEMO_KEY = 'demo.envelopeId';

export interface BudgetSummary {
  network: string;
  priceUsd: number | null;
  budgetTotalUsd: number;
  /** Funded into contracts, ever. */
  fundedSats: number;
  /** Given away to claimers: gone for good. */
  claimedSats: number;
  /** Returned to the sender by refunds. */
  refundedSats: number;
  /** Sponsor fees paid to our own treasury: recoverable (§10.1 rule 8). */
  feeSats: number;
  /** Still sitting in contracts (unclaimed shares, not yet refunded). */
  lockedSats: number;
  /** Funded − claimed − refunded − locked: what miners took (small). */
  networkFeesSats: number;
  spentUsdTotal: number;
  lockedUsd: number | null;
  /** budget − spent − locked (worst case: everything still locked gets claimed). */
  remainingBudgetUsd: number;
  warning: string | null;
  caps: Record<string, number>;
}

export interface DemoStatus {
  envelopeId: string | null;
  slug: string | null;
  status: string | null;
  sharesLeft: number;
  sharesTotal: number;
  secondsLeft: number;
  needsRefill: boolean;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PriceService) private readonly price: PriceService,
  ) {}

  authorize(header: string | undefined) {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const a = Buffer.from(token);
    const b = Buffer.from(this.config.ADMIN_TOKEN);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('UNAUTHORIZED');
  }

  async budget(): Promise<BudgetSummary> {
    const c = this.config;
    const sums = await this.db.ledgerEntry.groupBy({ by: ['kind'], _sum: { sats: true, usd: true } });
    const get = (k: string) => sums.find((s) => s.kind === k)?._sum;
    const locked =
      (
        await this.db.share.aggregate({
          _sum: { sats: true },
          where: { status: { in: ['AVAILABLE', 'HELD', 'RESERVED'] }, envelope: { network: 'MAINNET', fundedAt: { not: null } } },
        })
      )._sum.sats ?? 0n;
    const funded = get('FUND')?.sats ?? 0n;
    const claimed = get('CLAIMED')?.sats ?? 0n;
    const refunded = get('REFUNDED')?.sats ?? 0n;
    const fees = get('FEE')?.sats ?? 0n;
    const price = await this.price.bchUsd();
    const spentUsd = Number(get('CLAIMED')?.usd ?? 0);
    const lockedUsd = this.price.toUsd(locked, price);
    const remaining = Math.round((c.BUDGET_TOTAL_USD - spentUsd - (lockedUsd ?? 0)) * 100) / 100;
    const used = c.BUDGET_TOTAL_USD - remaining;
    const minerFees = funded - claimed - refunded - locked;
    return {
      network: c.NETWORK,
      priceUsd: price,
      budgetTotalUsd: c.BUDGET_TOTAL_USD,
      fundedSats: toNum(funded),
      claimedSats: toNum(claimed),
      refundedSats: toNum(refunded),
      feeSats: toNum(fees),
      lockedSats: toNum(locked),
      networkFeesSats: toNum(minerFees > 0n ? minerFees : 0n),
      spentUsdTotal: Math.round(spentUsd * 100) / 100,
      lockedUsd,
      remainingBudgetUsd: remaining,
      warning: used >= 0.8 * c.BUDGET_TOTAL_USD ? `${Math.round((used / c.BUDGET_TOTAL_USD) * 100)}% of the $${c.BUDGET_TOTAL_USD} budget is spent or locked` : null,
      caps: {
        MAX_ENVELOPE_USD: c.MAX_ENVELOPE_USD,
        MAX_ENVELOPE_SATS: c.MAX_ENVELOPE_SATS,
        MAX_SHARES: c.MAX_SHARES,
        MAX_ACTIVE_MAINNET_SATS: c.MAX_ACTIVE_MAINNET_SATS,
        DAILY_MAINNET_SATS: c.DAILY_MAINNET_SATS,
      },
    };
  }

  async demoStatus(): Promise<DemoStatus> {
    const id = (await this.db.setting.findUnique({ where: { key: DEMO_KEY } }))?.value ?? null;
    const env = id ? await this.db.envelope.findUnique({ where: { id }, include: { shares: true } }) : null;
    if (!env) return { envelopeId: null, slug: null, status: null, sharesLeft: 0, sharesTotal: 0, secondsLeft: 0, needsRefill: true };
    const left = env.shares.filter((s) => ['AVAILABLE', 'HELD', 'RESERVED'].includes(s.status)).length;
    const secondsLeft = Math.max(0, env.expiry - Math.floor(Date.now() / 1000));
    return {
      envelopeId: env.id,
      slug: env.slug,
      status: env.status,
      sharesLeft: left,
      sharesTotal: env.shareCount,
      secondsLeft,
      needsRefill: env.status !== 'ACTIVE' || left === 0 || secondsLeft === 0,
    };
  }

  /** Register a freshly funded envelope as the judge demo — only when the current one is used up. */
  async refill(body: unknown): Promise<DemoStatus> {
    const { envelopeId } = validate(z.object({ envelopeId: z.string().min(1).max(40) }).strict(), body);
    const current = await this.demoStatus();
    if (current.envelopeId && !current.needsRefill && current.envelopeId !== envelopeId) {
      throw new AppError('BUDGET_CAP', { cap: 'DEMO_ONE_AT_A_TIME', reasons: [`demo envelope ${current.slug} still has ${current.sharesLeft} share(s) left`] });
    }
    const env = await this.db.envelope.findUnique({ where: { id: envelopeId } });
    if (!env) throw new AppError('NOT_FOUND');
    if (env.status !== 'ACTIVE' || env.network !== this.config.NETWORK) {
      throw new AppError('NOT_FUNDED', { reasons: ['the demo envelope must be funded and ACTIVE on this network'] });
    }
    await this.db.setting.upsert({ where: { key: DEMO_KEY }, create: { key: DEMO_KEY, value: env.id }, update: { value: env.id } });
    return this.demoStatus();
  }
}
