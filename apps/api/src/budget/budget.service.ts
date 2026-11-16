// §10.1 budget caps — enforced server-side on MAINNET only (Chipnet coins are free).
//
// Checked twice, both times inside the caller's DB transaction under one advisory lock, so
// parallel requests can't both squeeze under a cap (review #5):
//   1. POST /envelopes  — before the envelope row is inserted;
//   2. POST /envelopes/:id/funded — before it becomes ACTIVE (an old pending envelope that no longer
//      counts can't be funded past the caps; its coins simply refund after expiry).
//
// What counts (review #3): FUNDED envelopes, plus unfunded ones only during their first hour.
// Never-funded envelopes (even ones the keeper marked EXPIRED) stop counting after that hour.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PriceService } from '../price/price.service.js';
import { AppError } from '../common/app-error.js';
import type { Prisma } from '../generated/prisma/client.js';

/** Unfunded mainnet envelopes count against the caps for this long. */
export const PENDING_COUNTS_FOR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

type Db = Prisma.TransactionClient;
interface Candidate {
  totalSats: bigint;
  shareCount: number;
  /** When re-checking at funding time: the envelope itself (don't count it twice). */
  excludeId?: string;
}

@Injectable()
export class BudgetService {
  private readonly log = new Logger('Budget');

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PriceService) private readonly price: PriceService,
  ) {}

  /** Throws BUDGET_CAP (422) with a machine-readable `cap`. Call inside a transaction. */
  async assertWithinCaps(db: Db, e: Candidate): Promise<void> {
    if (this.config.NETWORK !== 'MAINNET') return;
    const c = this.config;
    const cap = (name: string, limit: number) => new AppError('BUDGET_CAP', { cap: name, limit });

    if (e.shareCount > c.MAX_SHARES) throw cap('MAX_SHARES', c.MAX_SHARES);
    const price = await this.price.bchUsd();
    const usd = (sats: bigint) => (price === null ? null : (Number(sats) / 1e8) * price);
    const newUsd = usd(e.totalSats);
    if (newUsd !== null && newUsd > c.MAX_ENVELOPE_USD) throw cap('MAX_ENVELOPE_USD', c.MAX_ENVELOPE_USD);
    // Always also apply the sats cap: fallback when the price is unknown, and a backstop.
    if (e.totalSats > BigInt(c.MAX_ENVELOPE_SATS)) throw cap('MAX_ENVELOPE_SATS', c.MAX_ENVELOPE_SATS);

    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hongbao:mainnet-budget'))`;
    const now = Date.now();
    const pendingSince = new Date(now - PENDING_COUNTS_FOR_MS);
    const notSelf = e.excludeId ? { NOT: { id: e.excludeId } } : {};
    const sum = async (where: Prisma.EnvelopeWhereInput) =>
      (await db.envelope.aggregate({ _sum: { totalSats: true }, where: { network: 'MAINNET', ...notSelf, ...where } }))._sum.totalSats ?? 0n;

    // Locked now: funded and not yet fully claimed/refunded, plus fresh pending ones.
    const locked =
      (await sum({ fundedAt: { not: null }, status: { in: ['ACTIVE', 'EXPIRED'] } })) +
      (await sum({ status: 'PENDING_FUNDING', createdAt: { gte: pendingSince } }));
    if (locked + e.totalSats > BigInt(c.MAX_ACTIVE_MAINNET_SATS)) throw cap('MAX_ACTIVE_MAINNET_SATS', c.MAX_ACTIVE_MAINNET_SATS);

    // Today: funded in the last 24 h, plus fresh pending ones.
    const today =
      (await sum({ fundedAt: { gte: new Date(now - DAY_MS) } })) +
      (await sum({ status: 'PENDING_FUNDING', createdAt: { gte: pendingSince } }));
    if (today + e.totalSats > BigInt(c.DAILY_MAINNET_SATS)) throw cap('DAILY_MAINNET_SATS', c.DAILY_MAINNET_SATS);

    // Whole project: spent (claimed — gone for good) + still locked + this one ≤ BUDGET_TOTAL_USD.
    if (price !== null) {
      const spent = await db.ledgerEntry.aggregate({ _sum: { usd: true }, where: { kind: 'CLAIMED' } });
      const spentUsd = Number(spent._sum.usd ?? 0);
      const worstCase = spentUsd + usd(locked)! + newUsd!;
      if (worstCase > c.BUDGET_TOTAL_USD) throw cap('BUDGET_TOTAL_USD', c.BUDGET_TOTAL_USD);
      if (worstCase > 0.8 * c.BUDGET_TOTAL_USD) {
        this.log.warn(`budget at ${Math.round((worstCase / c.BUDGET_TOTAL_USD) * 100)}% of $${c.BUDGET_TOTAL_USD} (worst case)`);
      }
    }
  }
}
