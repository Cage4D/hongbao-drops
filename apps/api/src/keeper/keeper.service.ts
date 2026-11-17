// Keeper (spec §6.4, §8.1) — keyless. Called every minute by an external cron through
// POST /internal/keeper/tick (Vercel Hobby crons are daily only; Phase 0 decision).
//
// Safety: the keeper holds no keys. It can only build refundBatch txs, which the contract lets
// through only (a) after expiry (CHECKLOCKTIMEVERIFY; nodes also need median-time-past > expiry)
// and (b) to the sender's refund script baked into the contract. It can't refund early or to the
// wrong place even if this code or the DB were wrong — the tx would simply be rejected.
//
// Robustness (review #1, #8): every per-envelope step catches its own errors, candidates rotate by
// "last checked" so one bad envelope can't starve the rest, the lease is renewed between steps and
// only released by its owner, and money/event/ledger side effects happen once per txid.
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { binToHex, hexToBin } from '@bitauth/libauth';
import { hongbaoContract, planRefund } from '@hongbao/contract';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { PriceService } from '../price/price.service.js';
import { EventsService } from '../events/events.service.js';
import { toNum } from '../common/bigint.js';
import { truncateAddress } from '../common/address.js';
import { farmFlags } from './farm-flags.js';
import type { Envelope, Prisma, Share } from '../generated/prisma/client.js';

const LEASE_MS = 120_000;
const DAY = 24 * 3600 * 1000;
export const ACTIVATION_WINDOW_MS = 7 * DAY;
/** Re-check a claim's activation at most hourly. */
export const ACTIVATION_RECHECK_MS = 3600 * 1000;
/** A funding / claim tx the server no longer knows after this long is treated as dropped. */
export const DROPPED_AFTER_MS = 30 * 60 * 1000;
const UNSPENT: Share['status'][] = ['AVAILABLE', 'HELD', 'RESERVED'];

export interface TickSummary {
  ran: boolean;
  startedAt: string;
  ms?: number;
  released?: { holds: number; reservations: number };
  expiredEnvelopes?: number;
  reconciled?: number;
  failedEnvelopes?: number;
  refunds?: { envelopeId: string; txid: string; shares: number; sats: number }[];
  refundsWaiting?: number;
  dustSkipped?: number;
  confirmed?: number;
  dropped?: number;
  activation?: { checked: number; activated: number; notActivated: number };
  farm?: { flagged: number };
  errors: string[];
}

class LeaseLost extends Error {}

@Injectable()
export class KeeperService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Keeper');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(PriceService) private readonly price: PriceService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** Local dev convenience: KEEPER_INTERVAL_MS > 0 runs ticks in-process (production uses the cron). */
  onApplicationBootstrap() {
    if (this.config.KEEPER_INTERVAL_MS > 0) {
      this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(e)), this.config.KEEPER_INTERVAL_MS);
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ lease
  // Value = "<expires ISO>#<owner uuid>". Only the owner may renew or release it (review #8).

  private leaseValue(owner: string) {
    return `${new Date(Date.now() + LEASE_MS).toISOString()}#${owner}`;
  }

  private async acquireLease(owner: string): Promise<string | null> {
    const value = this.leaseValue(owner);
    const now = new Date();
    const rows = await this.db.$queryRaw<{ key: string }[]>`
      INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('keeper.lease', ${value}, ${now})
      ON CONFLICT (key) DO UPDATE SET value = ${value}, "updatedAt" = ${now}
      WHERE split_part("Setting".value, '#', 1) < ${now.toISOString()}
      RETURNING key`;
    return rows.length === 1 ? value : null;
  }

  /** Extend our lease; throws LeaseLost if another tick took over (we then stop at once). */
  private async renewLease(current: string, owner: string): Promise<string> {
    const next = this.leaseValue(owner);
    const r = await this.db.setting.updateMany({ where: { key: 'keeper.lease', value: current }, data: { value: next } });
    if (r.count !== 1) throw new LeaseLost('keeper lease lost to another tick');
    return next;
  }

  private async releaseLease(current: string) {
    await this.db.setting
      .updateMany({ where: { key: 'keeper.lease', value: current }, data: { value: new Date(0).toISOString() } })
      .catch(() => {});
  }

  // ------------------------------------------------------------------ tick

  async tick(): Promise<TickSummary> {
    const started = Date.now();
    const s: TickSummary = { ran: false, startedAt: new Date(started).toISOString(), errors: [] };
    const owner = randomUUID();
    let lease = await this.acquireLease(owner);
    if (!lease) return s;
    s.ran = true;

    const step = async (name: string, fn: () => Promise<void>) => {
      lease = await this.renewLease(lease!, owner);
      try {
        await fn();
      } catch (e) {
        if (e instanceof LeaseLost) throw e;
        const msg = `${name}: ${(e as Error).message}`;
        s.errors.push(msg);
        this.log.warn(msg);
      }
    };
    try {
      await step('cleanup', () => this.cleanup(s));
      await step('reconcile', () => this.reconcile(s));
      await step('refunds', () => this.refunds(s));
      await step('confirmations', () => this.confirmations(s));
      await step('activation', () => this.activation(s));
      await step('farmFlags', () => this.farm(s));
      s.ms = Date.now() - started;
      const at = new Date().toISOString();
      await this.db.$transaction([
        this.db.setting.upsert({ where: { key: 'keeper.lastRunAt' }, create: { key: 'keeper.lastRunAt', value: at }, update: { value: at } }),
        this.db.setting.upsert({
          where: { key: 'keeper.lastSummary' },
          create: { key: 'keeper.lastSummary', value: JSON.stringify(s) },
          update: { value: JSON.stringify(s) },
        }),
      ]);
      if (s.refunds?.length || s.errors.length) this.log.log(`tick ${JSON.stringify(s)}`);
      return s;
    } catch (e) {
      if (e instanceof LeaseLost) {
        s.errors.push(e.message);
        this.log.warn(e.message);
        return s;
      }
      throw e;
    } finally {
      await this.releaseLease(lease);
    }
  }

  /** Run fn for one envelope; errors are recorded, never abort the loop (review #1). */
  private async perEnvelope(s: TickSummary, step: string, env: Envelope, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      const msg = `${step} ${env.id}: ${(e as Error).message}`;
      s.errors.push(msg);
      this.log.warn(msg);
    }
  }

  // ------------------------------------------------------------------ 1. cleanup

  private async cleanup(s: TickSummary) {
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      // Lapsed approvals lose their share (the gate does this lazily too; this keeps views accurate).
      await tx.claim.updateMany({
        where: { status: 'APPROVED', share: { status: { in: ['RESERVED', 'HELD'] }, reservedUntil: { lt: now } } },
        data: { status: 'EXPIRED', shareId: null },
      });
      const holds = await tx.share.updateMany({
        where: { status: 'HELD', reservedUntil: { lt: now } },
        data: { status: 'AVAILABLE', holdToken: null, holdFingerprint: null, reservedUntil: null },
      });
      const res = await tx.share.updateMany({
        where: { status: 'RESERVED', reservedUntil: { lt: now } },
        data: { status: 'AVAILABLE', reservedUntil: null },
      });
      s.released = { holds: holds.count, reservations: res.count };
    });
    const nowSec = Math.floor(now.getTime() / 1000);
    const exp = await this.db.envelope.updateMany({
      where: { status: { in: ['ACTIVE', 'EXHAUSTED'] }, expiry: { lte: nowSec }, shares: { some: { status: 'AVAILABLE' } } },
      data: { status: 'EXPIRED' },
    });
    s.expiredEnvelopes = exp.count;
    await this.db.rateEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DAY) } } });
  }

  /**
   * Envelope status from its shares (review-2 P1-1, P1-2, P1-12). Once no share is unspent in the
   * DB the envelope is finished: EXHAUSTED if every share was claimed, otherwise REFUNDED. This
   * covers shares spent outside the keeper and the API, e.g. someone else broadcasting the keyless
   * refund first, or a claimer broadcasting the last claim directly. While shares are still unspent,
   * `ifUnspent` (if given) is applied. PENDING_FUNDING, FAILED and REFUNDED are never touched.
   * Emits `exhausted` when it is what ends the envelope.
   */
  private async settle(db: Prisma.TransactionClient, envelopeId: string, ifUnspent?: 'EXPIRED') {
    const env = await db.envelope.findUniqueOrThrow({ where: { id: envelopeId }, select: { status: true } });
    if (env.status !== 'ACTIVE' && env.status !== 'EXHAUSTED' && env.status !== 'EXPIRED') return;
    const rows = await db.share.groupBy({ by: ['status'], where: { envelopeId }, _count: { _all: true } });
    const n = (st: Share['status']) => rows.find((r) => r.status === st)?._count._all ?? 0;
    const unspent = n('AVAILABLE') + n('HELD') + n('RESERVED');
    const next = unspent > 0 ? (ifUnspent ?? env.status) : n('REFUNDED') > 0 ? 'REFUNDED' : 'EXHAUSTED';
    if (next === env.status) return;
    await db.envelope.update({ where: { id: envelopeId }, data: { status: next } });
    if (next === 'EXHAUSTED') await this.events.emit(envelopeId, 'exhausted', { claimed: n('CLAIMED') }, db);
  }

  private async contractFor(e: Envelope) {
    return hongbaoContract(
      {
        linkPk: hexToBin(e.linkPk),
        gatePk: hexToBin(e.gatePk),
        refundLockingBytecode: hexToBin(e.refundLockingBytecode),
        expiry: e.expiry,
        maxFee: BigInt(e.maxFee),
      },
      await this.chain.provider(),
    );
  }

  // ------------------------------------------------------------------ 2. reconcile (watcher)

  /** Rotate through every envelope the DB thinks still has unspent shares (review #1). */
  private async reconcile(s: TickSummary) {
    s.reconciled = 0;
    s.failedEnvelopes = 0;
    const envs = await this.db.envelope.findMany({
      where: { status: { in: ['ACTIVE', 'EXHAUSTED', 'EXPIRED'] }, shares: { some: { status: { in: UNSPENT } } } },
      orderBy: { reconciledAt: { sort: 'asc', nulls: 'first' } },
      take: 20,
    });
    for (const env of envs) {
      await this.perEnvelope(s, 'reconcile', env, () => this.reconcileEnvelope(env, s));
      await this.db.envelope.update({ where: { id: env.id }, data: { reconciledAt: new Date() } });
    }
  }

  /**
   * Shares the DB thinks are unspent but the chain says are gone were spent outside the API (e.g.
   * a lapsed approval broadcast directly, or someone else broadcast the refund). Find the spender
   * and record what happened. If the funding tx itself vanished, mark the envelope FAILED (review #13).
   */
  private async reconcileEnvelope(env: Envelope, s: TickSummary) {
    const shares = await this.db.share.findMany({ where: { envelopeId: env.id, status: { in: UNSPENT } } });
    if (shares.length === 0) return;
    const utxos = await this.chain.utxos(env.contractLockingBytecode);
    const onChain = new Set(utxos.map((u) => `${u.txid}:${u.vout}`));
    const gone = shares.filter((sh) => !onChain.has(`${sh.outpointTxid}:${sh.outpointIndex}`));
    if (gone.length === 0) return;

    if (utxos.length === 0 && env.fundingTxid && env.fundedAt && Date.now() - env.fundedAt.getTime() > DROPPED_AFTER_MS) {
      if (!(await this.chain.getRawTransaction(env.fundingTxid))) {
        await this.db.envelope.update({ where: { id: env.id }, data: { status: 'FAILED' } });
        s.failedEnvelopes = (s.failedEnvelopes ?? 0) + 1;
        this.log.warn(`envelope ${env.id} FAILED: funding tx ${env.fundingTxid} is no longer known to the network`);
        return;
      }
    }

    const price = await this.price.bchUsd();
    for (const h of await this.chain.history(env.contractLockingBytecode)) {
      if (h.tx_hash === env.fundingTxid) continue;
      const tx = await this.chain.getTransaction(h.tx_hash);
      if (!tx) continue;
      for (const sh of gone) {
        const i = tx.inputs.findIndex((inp) => binToHex(inp.outpointTransactionHash) === sh.outpointTxid && inp.outpointIndex === sh.outpointIndex);
        if (i < 0) continue;
        const out = tx.outputs[i] ?? tx.outputs[0]!;
        const toLB = binToHex(out.lockingBytecode);
        // A refund pays the sender AND carries locktime ≥ expiry (refundBatch's CHECKLOCKTIMEVERIFY
        // can't pass otherwise). A sender claiming a share of their own envelope also pays the
        // sender's script, but with an ordinary claim tx (locktime 0): that's a claim (review-2 P1-11).
        const isRefund = toLB === env.refundLockingBytecode && tx.locktime >= env.expiry;
        await this.db.$transaction(async (db) => {
          if (isRefund) {
            await db.share.update({ where: { id: sh.id }, data: { status: 'REFUNDED', spendTxid: h.tx_hash, reservedUntil: null, holdToken: null } });
            await db.claim.updateMany({ where: { shareId: sh.id, status: 'APPROVED' }, data: { status: 'EXPIRED', shareId: null } });
            return;
          }
          // Detach whoever currently holds the reservation on this share first: Claim.shareId is
          // unique, and they can't get a share that's already spent (review #10).
          const claim = await db.claim.findUnique({
            where: { envelopeId_recipientLockingBytecode: { envelopeId: env.id, recipientLockingBytecode: toLB } },
          });
          await db.claim.updateMany({
            where: { shareId: sh.id, ...(claim && { NOT: { id: claim.id } }) },
            data: { status: 'EXPIRED', shareId: null },
          });
          await db.share.update({ where: { id: sh.id }, data: { status: 'CLAIMED', spendTxid: h.tx_hash, reservedUntil: null, holdToken: null } });
          if (claim) {
            await db.claim.update({
              where: { id: claim.id },
              data: {
                status: 'BROADCAST',
                claimTxid: h.tx_hash,
                amountSats: out.valueSatoshis,
                shareId: sh.id,
                approvedShareIds: [...new Set([...claim.approvedShareIds, sh.id])],
              },
            });
            // Same payload as a claim relayed by the API (review-2 P1-12).
            const prevMax = await db.claim.aggregate({
              _max: { amountSats: true },
              where: { envelopeId: env.id, status: { in: ['BROADCAST', 'CONFIRMED'] }, NOT: { id: claim.id } },
            });
            const sharesLeft = await db.share.count({ where: { envelopeId: env.id, status: { in: UNSPENT } } });
            await this.events.emit(
              env.id,
              'claimed',
              {
                shareIndex: sh.index,
                address: truncateAddress(claim.recipientAddress),
                sats: toNum(out.valueSatoshis),
                usd: this.price.toUsd(out.valueSatoshis, price),
                isNewWallet: claim.isNewWallet,
                luckiest: env.mode === 'LUCKY' && out.valueSatoshis > (prevMax._max.amountSats ?? 0n),
                txid: h.tx_hash,
                stamp: sh.nftCommitment,
                sharesLeft,
                reconciled: true,
              },
              db,
            );
          }
        });
        s.reconciled = (s.reconciled ?? 0) + 1;
        this.log.log(`reconciled share ${env.id}#${sh.index} spent by ${h.tx_hash}`);
      }
    }
    // Finish the envelope if nothing is left (review-2 P1-2): without this, an envelope whose last
    // shares were spent outside the keeper and API stayed ACTIVE/EXPIRED forever.
    await this.settle(this.db, env.id);
  }

  // ------------------------------------------------------------------ 3. refunds

  /**
   * Refund every refundable UTXO at an expired contract — including envelopes that never became
   * ACTIVE (a sponsor skipped the fee: "their funds return after expiry") and fully-claimed ones
   * that received an extra payment (review #11). Candidates rotate by refundCheckedAt.
   */
  private async refunds(s: TickSummary) {
    s.refunds = [];
    s.refundsWaiting = 0;
    s.dustSkipped = 0;
    const nowSec = Math.floor(Date.now() / 1000);
    const envs = await this.db.envelope.findMany({
      where: {
        expiry: { lte: nowSec, gt: nowSec - 30 * 24 * 3600 },
        status: { in: ['PENDING_FUNDING', 'ACTIVE', 'EXHAUSTED', 'EXPIRED'] },
      },
      orderBy: { refundCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: 10,
    });
    if (envs.length === 0) return;
    const mtp = await this.chain.medianTimePast();
    for (const env of envs) {
      await this.perEnvelope(s, 'refund', env, () => this.refundEnvelope(env, mtp, s));
      await this.db.envelope.update({ where: { id: env.id }, data: { refundCheckedAt: new Date() } });
    }
  }

  private async refundEnvelope(env: Envelope, mtp: number, s: TickSummary) {
    const utxos = await this.chain.utxos(env.contractLockingBytecode);
    // Exact per-input fee, so shares at the API's minimum size refund too (review-2 P1-1).
    const plan = utxos.length
      ? planRefund({
          contract: await this.contractFor(env),
          utxos,
          refundLockingBytecode: env.refundLockingBytecode,
          expiry: env.expiry,
          maxFee: BigInt(env.maxFee),
        })
      : null;
    s.dustSkipped! += plan ? plan.dust.length : utxos.length; // anyone can send dust to a contract; it can't be refunded

    if (!plan) {
      const unspentInDb = await this.db.share.count({ where: { envelopeId: env.id, status: { in: UNSPENT } } });
      if (unspentInDb > 0) await this.reconcileEnvelope(env, s); // spent elsewhere: find out by whom
      else if (env.status === 'PENDING_FUNDING') await this.db.envelope.update({ where: { id: env.id }, data: { status: 'EXPIRED' } });
      else await this.settle(this.db, env.id);
      return;
    }
    if (mtp <= env.expiry) {
      s.refundsWaiting!++; // the network won't accept it yet; retry next tick
      return;
    }

    const { hex, refundedSats, batch } = plan;
    const txid = await this.chain.broadcast(hex);
    const outpoints = batch.map((u) => ({ outpointTxid: u.txid, outpointIndex: u.vout }));
    const price = env.network === 'MAINNET' ? await this.price.bchUsd() : null;

    const recorded = await this.db.$transaction(async (db) => {
      // Record each refund txid once, even if two ticks raced and both broadcast it (review #8).
      await db.$queryRaw`SELECT id FROM "Envelope" WHERE id = ${env.id} FOR UPDATE`;
      const seen = await db.event.findFirst({ where: { envelopeId: env.id, type: 'refunded', payload: { path: ['txid'], equals: txid } } });
      if (seen) return false;
      await db.share.updateMany({
        where: { envelopeId: env.id, OR: outpoints, status: { in: UNSPENT } },
        data: { status: 'REFUNDED', spendTxid: txid, reservedUntil: null, holdToken: null },
      });
      await db.claim.updateMany({ where: { envelopeId: env.id, status: 'APPROVED', share: { status: 'REFUNDED' } }, data: { status: 'EXPIRED', shareId: null } });
      await db.envelope.update({ where: { id: env.id }, data: { refundedSats: { increment: refundedSats }, refundedAt: new Date() } });
      // Status from what's actually left, not from this batch (review-2 P1-1): REFUNDED only once
      // no share is unspent in the DB. A never-verified envelope (no shares) is done once its
      // refundable coins are gone.
      if (env.status === 'PENDING_FUNDING') {
        if (plan.remaining.length === 0) await db.envelope.update({ where: { id: env.id }, data: { status: 'REFUNDED' } });
      } else {
        await this.settle(db, env.id, 'EXPIRED');
      }
      await this.events.emit(env.id, 'refunded', { txid, shares: batch.length, sats: toNum(refundedSats) }, db);
      if (env.network === 'MAINNET') {
        await db.ledgerEntry.create({
          data: { kind: 'REFUNDED', sats: refundedSats, usd: this.price.toUsd(refundedSats, price) ?? 0, txid, envelopeId: env.id },
        });
      }
      return true;
    });
    if (!recorded) return;
    s.refunds!.push({ envelopeId: env.id, txid, shares: batch.length, sats: toNum(refundedSats) });
    this.log.log(`refunded envelope=${env.id} shares=${batch.length} sats=${refundedSats} txid=${txid}`);
  }

  // ------------------------------------------------------------------ 4. confirmations

  /**
   * BROADCAST → CONFIRMED once mined. A claim tx the network no longer knows (lost a double-spend
   * race) is expired and its share freed, so it can't block the queue (review #15); rotation by
   * confirmCheckedAt keeps the step moving either way.
   */
  private async confirmations(s: TickSummary) {
    s.confirmed = 0;
    s.dropped = 0;
    const claims = await this.db.claim.findMany({
      where: { status: 'BROADCAST' },
      orderBy: { confirmCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: 50,
    });
    for (const c of claims) {
      try {
        const h = (await this.chain.history(c.recipientLockingBytecode)).find((x) => x.tx_hash === c.claimTxid);
        if (h && h.height > 0) {
          await this.db.claim.update({ where: { id: c.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmCheckedAt: new Date() } });
          s.confirmed++;
          continue;
        }
        if (!h && c.claimTxid && Date.now() - c.createdAt.getTime() > DROPPED_AFTER_MS && !(await this.chain.getRawTransaction(c.claimTxid))) {
          await this.db.$transaction(async (db) => {
            await db.claim.update({ where: { id: c.id }, data: { status: 'EXPIRED', shareId: null, confirmCheckedAt: new Date() } });
            if (c.shareId) {
              await db.share.updateMany({ where: { id: c.shareId, spendTxid: c.claimTxid }, data: { status: 'AVAILABLE', spendTxid: null } });
            }
          });
          s.dropped++;
          this.log.warn(`claim ${c.id} tx ${c.claimTxid} was dropped by the network; share released`);
          continue;
        }
        await this.db.claim.update({ where: { id: c.id }, data: { confirmCheckedAt: new Date() } });
      } catch (e) {
        s.errors.push(`confirmations ${c.id}: ${(e as Error).message}`);
      }
    }
  }

  // ------------------------------------------------------------------ 5. activation watcher

  /**
   * Activated = the claimed coins moved again within 7 days, or the claimer passed it on (spec §4).
   * Passing on only counts for a FUNDED child envelope that the claimer actually paid for — an
   * unfunded request costs nothing and must not count (review #2). Also records where swept coins
   * went, for the COMMON_SWEEP heuristic.
   */
  private async activation(s: TickSummary) {
    const now = Date.now();
    const claims = await this.db.claim.findMany({
      where: {
        status: { in: ['BROADCAST', 'CONFIRMED'] },
        activatedWithin7d: null,
        OR: [{ activationCheckedAt: null }, { activationCheckedAt: { lt: new Date(now - ACTIVATION_RECHECK_MS) } }],
      },
      orderBy: { activationCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: 50,
    });
    const a = { checked: 0, activated: 0, notActivated: 0 };
    for (const c of claims) {
      try {
        a.checked++;
        let movedAt: Date | null = await this.passedOnAt(c.envelopeId, c.recipientLockingBytecode);
        let sweptTo: string[] = c.sweptTo;
        if (!movedAt && c.claimTxid) {
          const stillThere = (await this.chain.utxos(c.recipientLockingBytecode)).some((u) => u.txid === c.claimTxid && u.vout === 0);
          if (!stillThere) {
            movedAt = new Date();
            sweptTo = await this.sweepDestinations(c.recipientLockingBytecode, c.claimTxid);
          }
        }
        const within = movedAt !== null && movedAt.getTime() - c.createdAt.getTime() <= ACTIVATION_WINDOW_MS;
        const expired = now - c.createdAt.getTime() > ACTIVATION_WINDOW_MS;
        const activatedWithin7d = within ? true : expired ? false : null;
        if (activatedWithin7d === true) a.activated++;
        if (activatedWithin7d === false) a.notActivated++;
        await this.db.claim.update({
          where: { id: c.id },
          data: { activationCheckedAt: new Date(), activatedWithin7d, ...(movedAt && { activatedAt: movedAt }), sweptTo },
        });
      } catch (e) {
        s.errors.push(`activation ${c.id}: ${(e as Error).message}`);
      }
    }
    s.activation = a;
  }

  /** When the claimer re-gifted from this envelope: a funded child whose funding spent the claimer's coins. */
  private async passedOnAt(envelopeId: string, claimerLB: string): Promise<Date | null> {
    const children = await this.db.envelope.findMany({
      where: { parentEnvelopeId: envelopeId, refundLockingBytecode: claimerLB, fundingTxid: { not: null }, status: { not: 'FAILED' } },
      select: { fundingTxid: true, fundedAt: true },
    });
    for (const ch of children) {
      const tx = await this.chain.getTransaction(ch.fundingTxid!);
      if (!tx) continue;
      for (const inp of tx.inputs) {
        const prev = await this.chain.getTransaction(binToHex(inp.outpointTransactionHash));
        const prevOut = prev?.outputs[inp.outpointIndex];
        if (prevOut && binToHex(prevOut.lockingBytecode) === claimerLB) return ch.fundedAt;
      }
    }
    return null;
  }

  /** Where the claimed output (claimTxid:0) went: outputs of the tx that spent it, minus change back to self. */
  private async sweepDestinations(recipientLB: string, claimTxid: string): Promise<string[]> {
    for (const h of await this.chain.history(recipientLB)) {
      if (h.tx_hash === claimTxid) continue;
      const tx = await this.chain.getTransaction(h.tx_hash);
      if (!tx?.inputs.some((i) => binToHex(i.outpointTransactionHash) === claimTxid && i.outpointIndex === 0)) continue;
      return tx.outputs.map((o) => binToHex(o.lockingBytecode)).filter((lb) => lb !== recipientLB && !lb.startsWith('6a'));
    }
    return [];
  }

  // ------------------------------------------------------------------ 6. farm flags

  private async farm(s: TickSummary) {
    const since = new Date(Date.now() - ACTIVATION_WINDOW_MS - DAY);
    const claims = await this.db.claim.findMany({
      where: { status: { in: ['BROADCAST', 'CONFIRMED'] }, envelope: { createdAt: { gte: since } } },
      include: { envelope: { select: { campaignId: true } } },
    });
    const groups = new Map<string, typeof claims>();
    for (const c of claims) {
      const k = c.envelope.campaignId ?? `env:${c.envelopeId}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(c);
    }
    let flagged = 0;
    for (const group of groups.values()) {
      const reasons = farmFlags(group);
      for (const c of group) {
        const r = reasons.get(c.id) ?? [];
        if (r.length) flagged++;
        if (r.join() !== c.farmReasons.join() || (r.length > 0) !== c.suspectedFarm) {
          await this.db.claim.update({ where: { id: c.id }, data: { farmReasons: r, suspectedFarm: r.length > 0 } });
        }
      }
    }
    s.farm = { flagged };
  }
}
