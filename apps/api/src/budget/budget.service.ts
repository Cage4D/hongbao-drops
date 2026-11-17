// §10.1 budget caps — enforced server-side on MAINNET only (Chipnet coins are free).
//
// Two kinds of cap (review-2 Q1):
//   - Per envelope, for everyone: MAX_SHARES, MAX_ENVELOPE_USD, MAX_ENVELOPE_SATS.
//   - Totals (MAX_ACTIVE_MAINNET_SATS, DAILY_MAINNET_SATS, BUDGET_TOTAL_USD) protect the builder's
//     $5 and only count envelopes refunding to BUDGET_WALLET_ADDRESS (the dedicated demo wallet).
//     Judges funding envelopes with their own BCH spend their own money and can't block the demo.
//
// The totals are worked out from share and envelope state, not from a separately written ledger
// (review-2 P1-2, P1-3): claims recorded by the keeper's reconcile, refunds broadcast by someone
// else and dropped claim txs then all count correctly, because they all end up in Share.status.
//   spent  = sats of CLAIMED shares (gone for good)
//   locked = sats of still-unspent shares of funded envelopes, plus unfunded envelopes in their first hour
//   today  = envelopes funded in the last 24 h, plus unfunded ones in their first hour
// The LedgerEntry table stays as an audit log of txids (see record()).
//
// Checked inside the caller's DB transaction under one advisory lock, so parallel requests can't
// both squeeze under a cap (review #5): at POST /envelopes, and at /funded for envelopes funded more
// than an hour after creation (review-2 Q2; within the hour they were already counted as pending).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PriceService } from '../price/price.service.js';
import { AppError } from '../common/app-error.js';
import type { LedgerKind, Prisma } from '../generated/prisma/client.js';

/** Unfunded mainnet envelopes count against the caps for this long. */
export const PENDING_COUNTS_FOR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const UNSPENT = ['AVAILABLE', 'HELD', 'RESERVED'] as const;

type Db = Prisma.TransactionClient;
interface Candidate {
  totalSats: bigint;
  shareCount: number;
  refundLockingBytecode: string;
  /** When re-checking at funding time: the envelope itself (don't count it twice). */
  excludeId?: string;
}

export interface BudgetState {
  /** Envelopes counted against the budget (refund to the demo wallet), ever funded. */
  fundedSats: bigint;
  spentSats: bigint;
  /** Unspent shares of funded envelopes. */
  lockedSats: bigint;
  /** Unfunded envelopes still in their first hour. */
  pendingSats: bigint;
  refundedShareSats: bigint;
  feeSats: bigint;
  /** Funded in the last 24 h. */
  fundedTodaySats: bigint;
}

@Injectable()
export class BudgetService {
  private readonly log = new Logger('Budget');

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PriceService) private readonly price: PriceService,
  ) {}

  /** Does this envelope count against the builder's budget (mainnet, refunds to the demo wallet)? */
  counts(env: { network: string; refundLockingBytecode: string }): boolean {
    return (
      this.config.NETWORK === 'MAINNET' &&
      env.network === 'MAINNET' &&
      this.config.budgetLockingBytecode !== null &&
      env.refundLockingBytecode === this.config.budgetLockingBytecode
    );
  }

  /** Live or last-known price; otherwise the conservative fallback (review-2 P1-4). */
  async capPrice(): Promise<{ usd: number; live: boolean }> {
    const p = await this.price.bchUsd();
    if (p !== null) return { usd: p, live: true };
    this.log.warn(`no BCH price known; caps use the fallback $${this.config.BUDGET_FALLBACK_BCH_USD}/BCH`);
    return { usd: this.config.BUDGET_FALLBACK_BCH_USD, live: false };
  }

  /** The demo wallet's position, from share and envelope state. */
  async state(db: Db, excludeId?: string): Promise<BudgetState> {
    const lb = this.config.budgetLockingBytecode;
    const zero: BudgetState = { fundedSats: 0n, spentSats: 0n, lockedSats: 0n, pendingSats: 0n, refundedShareSats: 0n, feeSats: 0n, fundedTodaySats: 0n };
    if (lb === null) return zero;
    const mine: Prisma.EnvelopeWhereInput = { network: 'MAINNET', refundLockingBytecode: lb, ...(excludeId && { NOT: { id: excludeId } }) };
    // FAILED = the funding tx vanished: its shares never existed on-chain.
    const funded: Prisma.EnvelopeWhereInput = { ...mine, fundedAt: { not: null }, status: { not: 'FAILED' } };
    const shareSum = async (status: Prisma.ShareWhereInput['status']) =>
      (await db.share.aggregate({ _sum: { sats: true }, where: { status, envelope: funded } }))._sum.sats ?? 0n;
    const envSum = async (where: Prisma.EnvelopeWhereInput) => {
      const r = await db.envelope.aggregate({ _sum: { totalSats: true, sponsorFeeSats: true }, where });
      return { total: r._sum.totalSats ?? 0n, fee: r._sum.sponsorFeeSats ?? 0n };
    };
    const now = Date.now();
    const all = await envSum(funded);
    return {
      fundedSats: all.total,
      feeSats: all.fee,
      spentSats: await shareSum('CLAIMED'),
      lockedSats: await shareSum({ in: [...UNSPENT] }),
      refundedShareSats: await shareSum('REFUNDED'),
      pendingSats: (await envSum({ ...mine, status: 'PENDING_FUNDING', createdAt: { gte: new Date(now - PENDING_COUNTS_FOR_MS) } })).total,
      fundedTodaySats: (await envSum({ ...funded, fundedAt: { gte: new Date(now - DAY_MS) } })).total,
    };
  }

  /** Throws BUDGET_CAP (422) with a machine-readable `cap`. Call inside a transaction. */
  async assertWithinCaps(db: Db, e: Candidate): Promise<void> {
    if (this.config.NETWORK !== 'MAINNET') return;
    const c = this.config;
    const cap = (name: string, limit: number) => new AppError('BUDGET_CAP', { cap: name, limit });

    // Per envelope, for everyone.
    if (e.shareCount > c.MAX_SHARES) throw cap('MAX_SHARES', c.MAX_SHARES);
    const price = await this.capPrice();
    const usd = (sats: bigint) => (Number(sats) / 1e8) * price.usd;
    if (usd(e.totalSats) > c.MAX_ENVELOPE_USD) throw cap('MAX_ENVELOPE_USD', c.MAX_ENVELOPE_USD);
    if (e.totalSats > BigInt(c.MAX_ENVELOPE_SATS)) throw cap('MAX_ENVELOPE_SATS', c.MAX_ENVELOPE_SATS); // backstop

    // Totals: only the builder's demo-wallet envelopes (review-2 Q1).
    if (!this.counts({ network: 'MAINNET', refundLockingBytecode: e.refundLockingBytecode })) return;
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hongbao:mainnet-budget'))`;
    const st = await this.state(db, e.excludeId);

    const locked = st.lockedSats + st.pendingSats;
    if (locked + e.totalSats > BigInt(c.MAX_ACTIVE_MAINNET_SATS)) throw cap('MAX_ACTIVE_MAINNET_SATS', c.MAX_ACTIVE_MAINNET_SATS);
    if (st.fundedTodaySats + st.pendingSats + e.totalSats > BigInt(c.DAILY_MAINNET_SATS)) throw cap('DAILY_MAINNET_SATS', c.DAILY_MAINNET_SATS);

    // Whole project: spent (claimed, gone for good) + still locked + this one ≤ BUDGET_TOTAL_USD.
    const worstCase = usd(st.spentSats + locked + e.totalSats);
    if (worstCase > c.BUDGET_TOTAL_USD) throw cap('BUDGET_TOTAL_USD', c.BUDGET_TOTAL_USD);
    if (worstCase > 0.8 * c.BUDGET_TOTAL_USD) {
      this.log.warn(`budget at ${Math.round((worstCase / c.BUDGET_TOTAL_USD) * 100)}% of $${c.BUDGET_TOTAL_USD} (worst case)`);
    }
  }

  /**
   * Audit-log entry for a demo-wallet envelope (§10.1 rule 7). Idempotent per (kind, txid,
   * envelope), so the API path and the keeper's reconcile can both report the same claim.
   */
  async record(db: Db, env: { id: string; network: string; refundLockingBytecode: string }, kind: LedgerKind, sats: bigint, txid: string, price: number | null) {
    if (!this.counts(env)) return;
    if (await db.ledgerEntry.findFirst({ where: { kind, txid, envelopeId: env.id }, select: { id: true } })) return;
    await db.ledgerEntry.create({ data: { kind, sats, usd: this.price.toUsd(sats, price) ?? 0, txid, envelopeId: env.id } });
  }

  /** A claim tx the network dropped: its CLAIMED entry no longer describes real spending. */
  async unrecordClaim(db: Db, envelopeId: string, txid: string) {
    await db.ledgerEntry.deleteMany({ where: { kind: 'CLAIMED', txid, envelopeId } });
  }
}
