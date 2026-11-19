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
import { BudgetService } from '../budget/budget.service.js';
import { AppError } from '../common/app-error.js';
import { validate } from '../common/validate.js';
import { toNum } from '../common/bigint.js';

const DEMO_KEY = 'demo.envelopeId';
/**
 * Mainnet envelopes live at most 24 h, so the demo needs a new envelope every day. The next one may
 * be registered once the current one has less than this long left, so the daily refill has a wide
 * window instead of one exact moment. The mainnet active and daily caps still bound what is locked.
 */
export const DEMO_REFILL_WINDOW_SECONDS = 16 * 3600;

/**
 * The demo wallet's position (BUDGET_WALLET_ADDRESS, review-2 Q1), worked out from share and
 * envelope state like the caps themselves (review-2 P1-2, P1-3). `ledger` is the audit log for comparison.
 */
export interface BudgetSummary {
  network: string;
  budgetWallet: string | null;
  priceUsd: number;
  /** false: no live or last-known price, so BUDGET_FALLBACK_BCH_USD is used. */
  priceLive: boolean;
  budgetTotalUsd: number;
  /** Funded into contracts, ever (FAILED envelopes excluded). */
  fundedSats: number;
  /** Shares given away to claimers: gone for good. */
  claimedSats: number;
  /** Shares returned to the sender (share value; each refund tx pays ~340 sat per share in fees). */
  refundedSats: number;
  /** Sponsor fees paid to our own treasury: recoverable (§10.1 rule 8). */
  feeSats: number;
  /** Still sitting in contracts (unclaimed shares, not yet refunded). */
  lockedSats: number;
  /** Unfunded envelopes still in their first hour (they count against the caps). */
  pendingSats: number;
  spentUsdTotal: number;
  lockedUsd: number;
  ledger: Record<'FUND' | 'CLAIMED' | 'REFUNDED' | 'FEE', number>;
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

export interface PublicDemo {
  /** null when there is no open demo envelope (used up, expired, or not refilled yet). */
  slug: string | null;
  sharesLeft: number;
  sharesTotal: number;
  secondsLeft: number;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PriceService) private readonly price: PriceService,
    @Inject(BudgetService) private readonly budgetSvc: BudgetService,
  ) {}

  authorize(header: string | undefined) {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const a = Buffer.from(token);
    const b = Buffer.from(this.config.ADMIN_TOKEN);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('UNAUTHORIZED');
  }

  async budget(): Promise<BudgetSummary> {
    const c = this.config;
    const st = await this.budgetSvc.state(this.db);
    const price = await this.budgetSvc.capPrice();
    const usd = (sats: bigint) => Math.round((Number(sats) / 1e8) * price.usd * 100) / 100;
    const spentUsd = usd(st.spentSats);
    const lockedUsd = usd(st.lockedSats + st.pendingSats);
    const remaining = Math.round((c.BUDGET_TOTAL_USD - spentUsd - lockedUsd) * 100) / 100;
    const used = c.BUDGET_TOTAL_USD - remaining;
    const sums = await this.db.ledgerEntry.groupBy({ by: ['kind'], _sum: { sats: true } });
    const ledgerSats = (k: string) => toNum(sums.find((s) => s.kind === k)?._sum.sats ?? 0n);
    return {
      network: c.NETWORK,
      budgetWallet: c.BUDGET_WALLET_ADDRESS ?? null,
      priceUsd: price.usd,
      priceLive: price.live,
      budgetTotalUsd: c.BUDGET_TOTAL_USD,
      fundedSats: toNum(st.fundedSats),
      claimedSats: toNum(st.spentSats),
      refundedSats: toNum(st.refundedShareSats),
      feeSats: toNum(st.feeSats),
      lockedSats: toNum(st.lockedSats),
      pendingSats: toNum(st.pendingSats),
      spentUsdTotal: spentUsd,
      lockedUsd,
      ledger: { FUND: ledgerSats('FUND'), CLAIMED: ledgerSats('CLAIMED'), REFUNDED: ledgerSats('REFUNDED'), FEE: ledgerSats('FEE') },
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
      needsRefill: env.status !== 'ACTIVE' || left === 0 || secondsLeft < DEMO_REFILL_WINDOW_SECONDS,
    };
  }

  /** Public: which envelope the stable /demo link opens right now (no amounts, no keys). */
  async currentDemo(): Promise<PublicDemo> {
    const d = await this.demoStatus();
    const open = d.status === 'ACTIVE' && d.sharesLeft > 0 && d.secondsLeft > 0;
    return { slug: open ? d.slug : null, sharesLeft: open ? d.sharesLeft : 0, sharesTotal: d.sharesTotal, secondsLeft: open ? d.secondsLeft : 0 };
  }

  /** Register a freshly funded envelope as the judge demo: only when the current one is used up or near its end. */
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
