// Keeper (spec §6.4, §8.1) — keyless. Called every minute by an external cron through
// POST /internal/keeper/tick (Vercel Hobby crons are daily only; Phase 0 decision).
//
// Safety: the keeper holds no keys. It can only build refundBatch txs, which the contract lets
// through only (a) after expiry (CHECKLOCKTIMEVERIFY; nodes also need median-time-past > expiry)
// and (b) to the sender's refund script baked into the contract. It can't refund early or to the
// wrong place even if this code or the DB were wrong — the tx would simply be rejected.
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { binToHex, hexToBin } from '@bitauth/libauth';
import { MAX_REFUND_BATCH, buildRefundTx, hongbaoContract } from '@hongbao/contract';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { PriceService } from '../price/price.service.js';
import { EventsService } from '../events/events.service.js';
import { toNum } from '../common/bigint.js';
import { truncateAddress } from '../common/address.js';
import { farmFlags } from './farm-flags.js';
import type { Envelope } from '../generated/prisma/client.js';

const LEASE_MS = 120_000;
const DAY = 24 * 3600 * 1000;
export const ACTIVATION_WINDOW_MS = 7 * DAY;
/** Re-check a claim's activation at most hourly. */
export const ACTIVATION_RECHECK_MS = 3600 * 1000;

export interface TickSummary {
  ran: boolean;
  startedAt: string;
  ms?: number;
  released?: { holds: number; reservations: number };
  expiredEnvelopes?: number;
  reconciled?: number;
  refunds?: { envelopeId: string; txid: string; shares: number; sats: number }[];
  refundsWaiting?: number;
  confirmed?: number;
  activation?: { checked: number; activated: number; notActivated: number };
  farm?: { flagged: number };
  errors: string[];
}

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

  /** One tick at a time across all instances: a lease row in Setting. */
  private async acquireLease(): Promise<boolean> {
    const now = new Date();
    const until = new Date(now.getTime() + LEASE_MS).toISOString();
    const rows = await this.db.$queryRaw<{ key: string }[]>`
      INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('keeper.lease', ${until}, ${now})
      ON CONFLICT (key) DO UPDATE SET value = ${until}, "updatedAt" = ${now}
      WHERE "Setting".value < ${now.toISOString()}
      RETURNING key`;
    return rows.length === 1;
  }
  private async releaseLease() {
    await this.db.setting.update({ where: { key: 'keeper.lease' }, data: { value: new Date(0).toISOString() } }).catch(() => {});
  }

  // ------------------------------------------------------------------ tick

  async tick(): Promise<TickSummary> {
    const started = Date.now();
    const s: TickSummary = { ran: false, startedAt: new Date(started).toISOString(), errors: [] };
    if (!(await this.acquireLease())) return s;
    s.ran = true;
    const step = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
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
    } finally {
      await this.releaseLease();
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

  /**
   * Shares the DB thinks are unspent but the chain says are gone were spent outside the API
   * (e.g. a lapsed approval broadcast directly). Find the spender and record what happened.
   */
  private async reconcile(s: TickSummary) {
    s.reconciled = 0;
    const envs = await this.db.envelope.findMany({
      where: { status: { in: ['ACTIVE', 'EXHAUSTED', 'EXPIRED'] }, shares: { some: { status: { in: ['AVAILABLE', 'HELD', 'RESERVED'] } } } },
      include: { shares: { where: { status: { in: ['AVAILABLE', 'HELD', 'RESERVED'] } } } },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    for (const env of envs) {
      const onChain = new Set((await this.chain.utxos(env.contractLockingBytecode)).map((u) => `${u.txid}:${u.vout}`));
      const gone = env.shares.filter((sh) => !onChain.has(`${sh.outpointTxid}:${sh.outpointIndex}`));
      if (gone.length === 0) continue;
      const history = await this.chain.history(env.contractLockingBytecode);
      for (const h of history) {
        if (h.tx_hash === env.fundingTxid) continue;
        const tx = await this.chain.getTransaction(h.tx_hash);
        if (!tx) continue;
        for (const sh of gone) {
          const i = tx.inputs.findIndex((inp) => binToHex(inp.outpointTransactionHash) === sh.outpointTxid && inp.outpointIndex === sh.outpointIndex);
          if (i < 0) continue;
          const out = tx.outputs[i] ?? tx.outputs[0]!;
          const toLB = binToHex(out.lockingBytecode);
          if (toLB === env.refundLockingBytecode) {
            await this.db.share.update({ where: { id: sh.id }, data: { status: 'REFUNDED', spendTxid: h.tx_hash, reservedUntil: null } });
          } else {
            await this.db.$transaction(async (db) => {
              await db.share.update({ where: { id: sh.id }, data: { status: 'CLAIMED', spendTxid: h.tx_hash, reservedUntil: null, holdToken: null } });
              const claim = await db.claim.findUnique({
                where: { envelopeId_recipientLockingBytecode: { envelopeId: env.id, recipientLockingBytecode: toLB } },
              });
              if (claim) {
                await db.claim.update({
                  where: { id: claim.id },
                  data: { status: 'BROADCAST', claimTxid: h.tx_hash, amountSats: out.valueSatoshis, shareId: sh.id },
                });
                await this.events.emit(env.id, 'claimed', {
                  shareIndex: sh.index,
                  address: truncateAddress(claim.recipientAddress),
                  sats: toNum(out.valueSatoshis),
                  isNewWallet: claim.isNewWallet,
                  txid: h.tx_hash,
                  stamp: sh.nftCommitment,
                  reconciled: true,
                }, db);
              }
            });
          }
          s.reconciled++;
          this.log.log(`reconciled share ${env.id}#${sh.index} spent by ${h.tx_hash}`);
        }
      }
    }
  }

  // ------------------------------------------------------------------ 3. refunds

  /**
   * Refund every UTXO still sitting at an expired contract — including envelopes that never became
   * ACTIVE (e.g. a sponsor skipped the fee output): "their funds return to them after expiry".
   */
  private async refunds(s: TickSummary) {
    s.refunds = [];
    s.refundsWaiting = 0;
    const nowSec = Math.floor(Date.now() / 1000);
    const envs = await this.db.envelope.findMany({
      where: {
        expiry: { lte: nowSec, gt: nowSec - 30 * 24 * 3600 },
        OR: [
          { status: { in: ['ACTIVE', 'EXHAUSTED', 'EXPIRED'] }, shares: { some: { status: { in: ['AVAILABLE', 'HELD', 'RESERVED'] } } } },
          { status: 'PENDING_FUNDING' },
        ],
      },
      orderBy: { expiry: 'asc' },
      take: 10,
    });
    if (envs.length === 0) return;
    const mtp = await this.chain.medianTimePast();

    for (const env of envs) {
      const utxos = await this.chain.utxos(env.contractLockingBytecode);
      if (utxos.length === 0) {
        // Never funded (or already emptied): nothing to refund.
        if (env.status === 'PENDING_FUNDING') await this.db.envelope.update({ where: { id: env.id }, data: { status: 'EXPIRED' } });
        continue;
      }
      if (mtp <= env.expiry) {
        s.refundsWaiting++; // the network won't accept it yet; retry next tick
        continue;
      }
      const batch = utxos.slice(0, MAX_REFUND_BATCH);
      const { hex, refundedSats } = buildRefundTx({
        contract: await this.contractFor(env),
        utxos: batch,
        refundLockingBytecode: env.refundLockingBytecode,
        expiry: env.expiry,
        maxFee: BigInt(env.maxFee),
      });
      const txid = await this.chain.broadcast(hex);
      const outpoints = batch.map((u) => ({ outpointTxid: u.txid, outpointIndex: u.vout }));
      const price = env.network === 'MAINNET' ? await this.price.bchUsd() : null;

      await this.db.$transaction(async (db) => {
        await db.share.updateMany({
          where: { envelopeId: env.id, OR: outpoints, status: { in: ['AVAILABLE', 'HELD', 'RESERVED'] } },
          data: { status: 'REFUNDED', spendTxid: txid, reservedUntil: null, holdToken: null },
        });
        await db.claim.updateMany({ where: { envelopeId: env.id, status: 'APPROVED' }, data: { status: 'EXPIRED', shareId: null } });
        const left = utxos.length - batch.length;
        await db.envelope.update({
          where: { id: env.id },
          data: {
            refundedSats: { increment: refundedSats },
            refundedAt: new Date(),
            status: left === 0 ? 'REFUNDED' : 'EXPIRED',
          },
        });
        await this.events.emit(env.id, 'refunded', { txid, shares: batch.length, sats: toNum(refundedSats) }, db);
        if (env.network === 'MAINNET') {
          await db.ledgerEntry.create({
            data: { kind: 'REFUNDED', sats: refundedSats, usd: this.price.toUsd(refundedSats, price) ?? 0, txid, envelopeId: env.id },
          });
        }
      });
      s.refunds.push({ envelopeId: env.id, txid, shares: batch.length, sats: toNum(refundedSats) });
      this.log.log(`refunded envelope=${env.id} shares=${batch.length} sats=${refundedSats} txid=${txid}`);
    }
  }

  // ------------------------------------------------------------------ 4. confirmations

  private async confirmations(s: TickSummary) {
    s.confirmed = 0;
    const claims = await this.db.claim.findMany({ where: { status: 'BROADCAST' }, orderBy: { createdAt: 'asc' }, take: 50 });
    for (const c of claims) {
      const h = (await this.chain.history(c.recipientLockingBytecode)).find((x) => x.tx_hash === c.claimTxid);
      if (h && h.height > 0) {
        await this.db.claim.update({ where: { id: c.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
        s.confirmed++;
      }
    }
  }

  // ------------------------------------------------------------------ 5. activation watcher

  /**
   * Activated = the claimed coins moved again within 7 days, or the claimer passed it on
   * (spec §4). Also records where swept coins went, for the COMMON_SWEEP heuristic.
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
      a.checked++;
      const passedOn = await this.db.envelope.findFirst({
        where: { parentEnvelopeId: c.envelopeId, refundLockingBytecode: c.recipientLockingBytecode, status: { not: 'PENDING_FUNDING' } },
        select: { createdAt: true },
      });
      let movedAt: Date | null = passedOn?.createdAt ?? null;
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
    }
    s.activation = a;
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
