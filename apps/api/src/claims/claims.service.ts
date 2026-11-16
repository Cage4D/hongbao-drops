// The gate (spec §6.2, §8.2) — the security core.
//
// What it signs: a 64-byte Schnorr datasig over  recipientLockingBytecode ‖ outpoint  with the
// envelope's gate key. That approval is only useful together with the link secret, and only for
// that one share going to that one address.
//
// When it signs: envelope ACTIVE and not expired; one claim per recipient script, per wallet
// fingerprint and per hold token; quiz answered; IP not rate-limited; a share reserved for this
// claimer. Reservations use SELECT … FOR UPDATE SKIP LOCKED so parallel claims never get the
// same share, and they expire (120 s / 15 min holds) so abandoned claims free their share.
import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { binToHex, cashAddressToLockingBytecode, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { gateMessage, signGateApproval } from '@hongbao/contract';
import {
  BroadcastRequestSchema,
  ClaimRequestSchema,
  HoldRequestSchema,
  type BroadcastResponse,
  type ClaimApproval,
  type HoldResponse,
} from '@hongbao/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KeysService } from '../keys/keys.service.js';
import { ChainService } from '../chain/chain.service.js';
import { PriceService } from '../price/price.service.js';
import { RateLimitService, LIMITS, WINDOW_MS } from '../ratelimit/rate-limit.service.js';
import { AppError } from '../common/app-error.js';
import { validate } from '../common/validate.js';
import { toNum } from '../common/bigint.js';
import { truncateAddress } from '../common/address.js';
import { hashAnswer } from '../envelopes/envelopes.service.js';
import { EventsService } from '../events/events.service.js';
import { stampAlt } from '../media/stamp.js';
import type { Claim, Envelope, Prisma, Share } from '../generated/prisma/client.js';

export const RESERVATION_MS = 120_000;
export const HOLD_MS = 15 * 60_000;

type Tx = Prisma.TransactionClient;

@Injectable()
export class ClaimsService {
  private readonly log = new Logger('Gate');

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(PriceService) private readonly price: PriceService,
    @Inject(RateLimitService) private readonly rate: RateLimitService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  // ------------------------------------------------------------------ helpers

  private async loadClaimable(envelopeId: string): Promise<Envelope> {
    const env = await this.db.envelope.findUnique({ where: { id: envelopeId } });
    if (!env) throw new AppError('NOT_FOUND');
    if (env.status === 'PENDING_FUNDING') throw new AppError('NOT_FUNDED');
    if (env.status === 'FAILED') throw new AppError('NOT_FUNDED');
    if (env.status === 'EXPIRED' || env.status === 'REFUNDED' || Date.now() / 1000 >= env.expiry) {
      throw new AppError('ENVELOPE_EXPIRED');
    }
    if (env.status === 'EXHAUSTED') throw new AppError('ENVELOPE_EMPTY');
    return env;
  }

  private recipientLockingBytecode(address: string): string {
    const want = this.config.NETWORK === 'MAINNET' ? 'bitcoincash:' : 'bchtest:';
    const r = cashAddressToLockingBytecode(address);
    if (typeof r === 'string' || !address.startsWith(want)) {
      throw new AppError('INVALID_REQUEST', { issues: [{ path: 'recipientAddress', message: `must be a ${want} address` }] });
    }
    return binToHex(r.bytecode);
  }

  /**
   * Lock and return the next free share: AVAILABLE, or a HELD/RESERVED one whose time ran out.
   * SKIP LOCKED: concurrent claimers each get a different row instead of waiting on the same one.
   */
  private async pickFreeShare(tx: Tx, envelopeId: string): Promise<Share | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Share"
      WHERE "envelopeId" = ${envelopeId}
        AND (status = 'AVAILABLE' OR (status IN ('HELD', 'RESERVED') AND "reservedUntil" < ${new Date()}))
      ORDER BY index
      LIMIT 1
      FOR UPDATE SKIP LOCKED`;
    return rows[0] ? tx.share.findUnique({ where: { id: rows[0].id } }) : null;
  }

  /** A timed-out reservation is being reused: its old (never broadcast) claim no longer owns it. */
  private async releaseStaleClaim(tx: Tx, shareId: string) {
    await tx.claim.updateMany({ where: { shareId, status: 'APPROVED' }, data: { status: 'EXPIRED', shareId: null } });
  }

  private approval(env: Envelope, share: Share, claim: Claim): ClaimApproval {
    const gateSig = signGateApproval(
      this.keys.gatePrivateKey(env.seq),
      gateMessage(hexToBin(claim.recipientLockingBytecode), share.outpointTxid, share.outpointIndex),
    );
    return {
      claimId: claim.id,
      share: {
        index: share.index,
        outpointTxid: share.outpointTxid,
        outpointIndex: share.outpointIndex,
        sats: toNum(share.sats),
        tokenCategory: share.nftCommitment ? env.stampCategory : null,
        nftCommitment: share.nftCommitment,
      },
      gateSig: binToHex(gateSig),
      recipientLockingBytecode: claim.recipientLockingBytecode,
      contractLockingBytecode: env.contractLockingBytecode,
      constructorArgs: {
        linkPk: env.linkPk,
        gatePk: env.gatePk,
        refundLockingBytecode: env.refundLockingBytecode,
        expiry: env.expiry,
        maxFee: env.maxFee,
      },
      reservedUntil: share.reservedUntil!.toISOString(),
      isNewWallet: claim.isNewWallet,
    };
  }

  // ------------------------------------------------------------------ POST /envelopes/:id/holds

  /** "Hold my share" for people with no wallet yet: reserves a share for 15 minutes. */
  async hold(envelopeId: string, body: unknown, ip: string): Promise<HoldResponse> {
    const req = validate(HoldRequestSchema, body ?? {});
    const env = await this.loadClaimable(envelopeId);
    const ipHash = this.rate.ipHash(ip);
    await this.rate.hit(`hold:${env.id}:${ipHash}`, LIMITS.hold);

    const share = await this.db.$transaction(async (tx) => {
      if (req.fingerprint) {
        const mine = await tx.share.findFirst({
          where: { envelopeId: env.id, holdFingerprint: req.fingerprint, status: 'HELD', reservedUntil: { gt: new Date() } },
        });
        if (mine) return mine; // same device asking again: same hold
      }
      const free = await this.pickFreeShare(tx, env.id);
      if (!free) throw new AppError('ENVELOPE_EMPTY');
      await this.releaseStaleClaim(tx, free.id);
      return tx.share.update({
        where: { id: free.id },
        data: {
          status: 'HELD',
          holdToken: randomBytes(24).toString('base64url'),
          holdFingerprint: req.fingerprint ?? null,
          reservedUntil: new Date(Date.now() + HOLD_MS),
        },
      });
    });
    this.log.log(`hold envelope=${env.id} share=${share.index} until=${share.reservedUntil!.toISOString()}`);
    await this.events.emit(env.id, 'held', { shareIndex: share.index, heldUntil: share.reservedUntil!.toISOString() });
    return { holdToken: share.holdToken!, heldUntil: share.reservedUntil!.toISOString() };
  }

  // ------------------------------------------------------------------ POST /envelopes/:id/claims

  async claim(envelopeId: string, body: unknown, ip: string): Promise<ClaimApproval> {
    const req = validate(ClaimRequestSchema, body);
    const recipientLB = this.recipientLockingBytecode(req.recipientAddress);

    // Same recipient again: refuse if they already received their share — checked before the
    // empty/expired checks so a returning claimer hears "you already grabbed one", not "too slow".
    const existing = await this.db.claim.findUnique({
      where: { envelopeId_recipientLockingBytecode: { envelopeId, recipientLockingBytecode: recipientLB } },
      include: { share: true },
    });
    if (existing?.status === 'BROADCAST' || existing?.status === 'CONFIRMED') throw new AppError('ALREADY_CLAIMED');

    const env = await this.loadClaimable(envelopeId);
    const ipHash = this.rate.ipHash(ip);
    await this.rate.hit(`claim:${env.id}:${ipHash}`, LIMITS.claim);

    // A live approval for this recipient: hand it back (a retry after a network blip keeps the
    // claimer's place) — only while the reservation is still running and the share unspent (review #10).
    if (
      existing?.status === 'APPROVED' &&
      existing.share?.status === 'RESERVED' &&
      !existing.share.spendTxid &&
      existing.share.reservedUntil &&
      existing.share.reservedUntil > new Date()
    ) {
      const share = await this.db.share.update({
        where: { id: existing.share.id },
        data: { reservedUntil: new Date(Date.now() + RESERVATION_MS) },
      });
      return this.approval(env, share, existing);
    }

    // Quiz (spec §8.2): salted hashes of normalised answers; 5 wrong tries per IP per 10 min.
    if (env.mode === 'QUIZ') {
      // Count, check and record under one lock so parallel guesses can't exceed the limit (review #7).
      const verdict = await this.rate.locked(`wrong:${env.id}:${ipHash}`, WINDOW_MS, async (wrong, record) => {
        if (wrong >= LIMITS.wrongAnswer) return { limited: true as const };
        const ok = !!req.answer && env.quizAnswerHashes.includes(hashAnswer(env.quizSalt!, req.answer));
        if (!ok) await record();
        return { limited: false as const, ok, attemptsLeft: Math.max(0, LIMITS.wrongAnswer - wrong - 1) };
      });
      if (verdict.limited) throw new AppError('RATE_LIMITED');
      if (!verdict.ok) throw new AppError('WRONG_ANSWER', { attemptsLeft: verdict.attemptsLeft });
    }

    // Fresh-wallet check before reserving (doesn't hold a row lock during a network call).
    const hadHistory = await this.chain.hasHistory(recipientLB);

    const { claim, share } = await this.db.$transaction(async (tx) => {
      // Serialise claims per (envelope, fingerprint) so two addresses of one wallet can't race past the check.
      if (req.walletFingerprint) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${env.id}:${req.walletFingerprint}`}))`;
        const dup = await tx.claim.findFirst({
          where: {
            envelopeId: env.id,
            walletFingerprint: req.walletFingerprint,
            status: { in: ['APPROVED', 'BROADCAST', 'CONFIRMED'] },
            NOT: { recipientLockingBytecode: recipientLB },
          },
        });
        if (dup) throw new AppError('ALREADY_CLAIMED');
      }

      // Serialise the same recipient (parallel retries) so the pinning below sees a stable state.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${env.id}:${recipientLB}`}))`;
      const mine = await tx.claim.findUnique({
        where: { envelopeId_recipientLockingBytecode: { envelopeId: env.id, recipientLockingBytecode: recipientLB } },
      });
      if (mine?.status === 'BROADCAST' || mine?.status === 'CONFIRMED') throw new AppError('ALREADY_CLAIMED');

      // Approvals stay valid on-chain forever. If this recipient was ever approved for a share
      // that is still unspent, they may only get THAT share again — never a second outpoint,
      // or they could broadcast both approvals and take two shares (review #6).
      const now = new Date();
      let share: Share | null = null;
      const pinnedIds = mine?.approvedShareIds ?? [];
      if (pinnedIds.length) {
        const pinned = await tx.$queryRaw<Share[]>`
          SELECT * FROM "Share" WHERE id = ANY(${pinnedIds}) AND status IN ('AVAILABLE', 'HELD', 'RESERVED')
          ORDER BY index FOR UPDATE`;
        if (pinned.length) {
          share =
            pinned.find(
              (sh) =>
                sh.status === 'AVAILABLE' ||
                (sh.reservedUntil !== null && sh.reservedUntil < now) ||
                (sh.status === 'HELD' && req.holdToken && sh.holdToken === req.holdToken) ||
                (sh.status === 'RESERVED' && mine?.shareId === sh.id),
            ) ?? null;
          if (!share) {
            throw new AppError('ALREADY_CLAIMED', {
              reason: 'An earlier approval for this address is still open. Try again in a couple of minutes.',
            });
          }
        }
      }
      if (!share && req.holdToken) {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Share" WHERE "holdToken" = ${req.holdToken} AND "envelopeId" = ${env.id} FOR UPDATE`;
        share = rows[0] ? await tx.share.findUnique({ where: { id: rows[0].id } }) : null;
        if (!share || share.status !== 'HELD' || !share.reservedUntil || share.reservedUntil < now) {
          throw new AppError('HOLD_EXPIRED');
        }
      }
      if (!share) {
        share = await this.pickFreeShare(tx, env.id);
        if (!share) throw new AppError('ENVELOPE_EMPTY');
      }
      // Any other claimer whose reservation on this share lapsed loses it.
      await tx.claim.updateMany({
        where: { shareId: share.id, status: 'APPROVED', ...(mine && { NOT: { id: mine.id } }) },
        data: { status: 'EXPIRED', shareId: null },
      });

      const reserved = await tx.share.update({
        where: { id: share.id },
        data: { status: 'RESERVED', holdToken: null, reservedUntil: new Date(Date.now() + RESERVATION_MS) },
      });
      const approvedShareIds = [...new Set([...(mine?.approvedShareIds ?? []), reserved.id])];
      try {
        const claim = mine
          ? await tx.claim.update({
              where: { id: mine.id },
              data: {
                status: 'APPROVED',
                shareId: reserved.id,
                approvedShareIds,
                walletFingerprint: req.walletFingerprint ?? mine.walletFingerprint,
                ipHash,
              },
            })
          : await tx.claim.create({
              data: {
                envelopeId: env.id,
                shareId: reserved.id,
                recipientAddress: req.recipientAddress,
                recipientLockingBytecode: recipientLB,
                walletFingerprint: req.walletFingerprint ?? null,
                ipHash,
                isNewWallet: hadHistory === null ? null : !hadHistory,
                status: 'APPROVED',
                approvedShareIds,
              },
            });
        return { claim, share: reserved };
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') throw new AppError('ALREADY_CLAIMED');
        throw e;
      }
    });

    this.log.log(
      `approved claim=${claim.id} envelope=${env.id} share=${share.index} outpoint=${share.outpointTxid}:${share.outpointIndex} newWallet=${claim.isNewWallet}`,
    );
    return this.approval(env, share, claim);
  }

  // ------------------------------------------------------------------ POST /claims/:id/broadcast

  async broadcast(claimId: string, body: unknown): Promise<BroadcastResponse> {
    const { rawTx } = validate(BroadcastRequestSchema, body);
    const claim = await this.db.claim.findUnique({ where: { id: claimId }, include: { share: true, envelope: true } });
    if (!claim) throw new AppError('NOT_FOUND');
    const env = claim.envelope;

    if (claim.status === 'BROADCAST' || claim.status === 'CONFIRMED') {
      if (claim.claimTxid && (await this.chain.broadcast(rawTx).catch(() => null)) === claim.claimTxid) {
        return this.broadcastResponse(env, claim.share, claim.claimTxid, claim.amountSats ?? 0n);
      }
      throw new AppError('ALREADY_CLAIMED');
    }
    const share = claim.share;
    if (claim.status === 'EXPIRED' || !share || share.status !== 'RESERVED') throw new AppError('HOLD_EXPIRED');

    // Check the tx before relaying it: the contract enforces the same rules, but this gives clear
    // errors and stops the API from relaying anything that isn't this exact claim.
    const tx = decodeTransaction(hexToBin(rawTx));
    if (typeof tx === 'string') throw new AppError('INVALID_REQUEST', { reasons: [`undecodable transaction: ${tx}`] });
    const reasons: string[] = [];
    const input = tx.inputs[0];
    const output = tx.outputs[0];
    if (tx.inputs.length !== 1 || !input || binToHex(input.outpointTransactionHash) !== share.outpointTxid || input.outpointIndex !== share.outpointIndex) {
      reasons.push('the transaction must spend exactly the approved share');
    }
    if (tx.outputs.length !== 1 || !output || binToHex(output.lockingBytecode) !== claim.recipientLockingBytecode) {
      reasons.push('the transaction must have exactly one output, to the approved address');
    }
    if (output && output.valueSatoshis < share.sats - BigInt(env.maxFee)) reasons.push('the network fee is above the envelope limit');
    if (output && share.nftCommitment) {
      const t = output.token;
      if (!t || binToHex(t.category) !== env.stampCategory || !t.nft || binToHex(t.nft.commitment) !== share.nftCommitment) {
        reasons.push('the stamp must go to the claimer unchanged');
      }
    } else if (output?.token) reasons.push('unexpected token on a stamp-less share');
    if (reasons.length) throw new AppError('INVALID_REQUEST', { reasons });

    const txid = await this.chain.broadcast(rawTx);
    const amount = output!.valueSatoshis;
    const price = await this.price.bchUsd();

    const recorded = await this.db.$transaction(async (db) => {
      // One envelope at a time: parallel broadcasts each see the others' CLAIMED shares, so the
      // last one reliably marks the envelope EXHAUSTED (this was a flaky race in testing).
      await db.$queryRaw`SELECT id FROM "Envelope" WHERE id = ${env.id} FOR UPDATE`;
      // Only the first of several identical requests (double tap, retry) records anything (review #8).
      const won = await db.claim.updateMany({
        where: { id: claim.id, status: 'APPROVED', shareId: share.id },
        data: { status: 'BROADCAST', claimTxid: txid, amountSats: amount },
      });
      if (won.count === 0) return false;
      await db.share.update({ where: { id: share.id }, data: { status: 'CLAIMED', spendTxid: txid, reservedUntil: null } });
      const left = await db.share.count({ where: { envelopeId: env.id, status: { in: ['AVAILABLE', 'HELD', 'RESERVED'] } } });
      const prevMax = await db.claim.aggregate({
        _max: { amountSats: true },
        where: { envelopeId: env.id, status: { in: ['BROADCAST', 'CONFIRMED'] }, NOT: { id: claim.id } },
      });
      await this.events.emit(
        env.id,
        'claimed',
        {
          shareIndex: share.index,
          address: truncateAddress(claim.recipientAddress),
          sats: toNum(amount),
          usd: this.price.toUsd(amount, price),
          isNewWallet: claim.isNewWallet,
          luckiest: env.mode === 'LUCKY' && amount > (prevMax._max.amountSats ?? 0n),
          txid,
          stamp: share.nftCommitment,
          sharesLeft: left,
        },
        db,
      );
      if (left === 0) {
        await db.envelope.updateMany({ where: { id: env.id, status: 'ACTIVE' }, data: { status: 'EXHAUSTED' } });
        await this.events.emit(env.id, 'exhausted', { claimed: env.shareCount }, db);
      }
      if (env.network === 'MAINNET') {
        await db.ledgerEntry.create({
          data: { kind: 'CLAIMED', sats: share.sats, usd: this.price.toUsd(share.sats, price) ?? 0, txid, envelopeId: env.id },
        });
      }
      return true;
    });
    if (!recorded) {
      const now = await this.db.claim.findUniqueOrThrow({ where: { id: claim.id } });
      if (now.claimTxid !== txid) throw new AppError('HOLD_EXPIRED');
      return this.broadcastResponse(env, share, txid, now.amountSats ?? amount, price);
    }
    this.log.log(`broadcast claim=${claim.id} txid=${txid} amount=${amount}`);
    return this.broadcastResponse(env, share, txid, amount, price);
  }

  private async broadcastResponse(env: Envelope, share: Share | null, txid: string, amount: bigint, price?: number | null): Promise<BroadcastResponse> {
    const p = price === undefined ? await this.price.bchUsd() : price;
    const api = this.config.PUBLIC_API_URL.replace(/\/$/, '');
    return {
      txid,
      amountSats: toNum(amount),
      amountUsd: this.price.toUsd(amount, p),
      stamp:
        share?.nftCommitment && env.stampCategory
          ? {
              category: env.stampCategory,
              commitment: share.nftCommitment,
              imageUrl: `${api}/stamps/${env.stampCategory}/${share.nftCommitment}.png`,
              alt: stampAlt({ theme: env.theme, seq: env.seq, index: share.index, shareCount: env.shareCount }),
            }
          : null,
    };
  }
}
