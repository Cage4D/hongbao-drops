// POST /wallets/activity: what a connected wallet sent, claimed and passed on (Phase 9).
//
// The site sends the connected wallet's own derived P2PKH locking bytecodes. Everything returned
// is already public in some form (on-chain transactions, public envelope views): no link secrets
// (the server never has them) and no other people's addresses. Envelopes match on their refund
// locking bytecode (where leftovers go), claims on the recipient's.
import { Inject, Injectable } from '@nestjs/common';
import {
  WalletActivityRequestSchema,
  type Mode,
  type Theme,
  type WalletActivityResponse,
  type WalletClaim,
  type WalletSentEnvelope,
} from '@hongbao/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceService } from '../price/price.service.js';
import { RateLimitService } from '../ratelimit/rate-limit.service.js';
import { validate } from '../common/validate.js';
import { toNum } from '../common/bigint.js';

/** Activity lookups per IP per 10 min. */
export const WALLET_ACTIVITY_LIMIT = 30;
const MAX_ROWS = 100;

@Injectable()
export class WalletsService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PriceService) private readonly price: PriceService,
    @Inject(RateLimitService) private readonly rate: RateLimitService,
  ) {}

  async activity(body: unknown, ip: string): Promise<WalletActivityResponse> {
    const { lockingBytecodes } = validate(WalletActivityRequestSchema, body);
    await this.rate.hit(`wallet:${this.rate.ipHash(ip)}`, WALLET_ACTIVITY_LIMIT);
    const mine = [...new Set(lockingBytecodes)];
    const network = this.config.NETWORK;

    const [envelopes, claims] = await Promise.all([
      this.db.envelope.findMany({
        // Sealed envelopes only: an unfinished or vanished funding isn't a drop.
        where: { network, refundLockingBytecode: { in: mine }, status: { notIn: ['PENDING_FUNDING', 'FAILED'] } },
        include: { shares: { select: { status: true, sats: true } } },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      }),
      this.db.claim.findMany({
        where: { recipientLockingBytecode: { in: mine }, status: { in: ['BROADCAST', 'CONFIRMED'] }, envelope: { network } },
        include: {
          envelope: { select: { id: true, slug: true, theme: true, mode: true, message: true, sealCategory: true } },
          share: { select: { nftCommitment: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      }),
    ]);

    // A claim was passed on when this wallet funded an envelope whose parent is the claimed one.
    const childByParent = new Map<string, { id: string; slug: string }>();
    for (const e of [...envelopes].reverse()) {
      if (e.parentEnvelopeId && !childByParent.has(e.parentEnvelopeId)) childByParent.set(e.parentEnvelopeId, { id: e.id, slug: e.slug });
    }

    const price = await this.price.bchUsd();
    const now = Math.floor(Date.now() / 1000);
    const api = this.config.PUBLIC_API_URL.replace(/\/$/, '');

    const sent: WalletSentEnvelope[] = envelopes.map((e) => {
      const unclaimed = e.shares.filter((s) => ['AVAILABLE', 'HELD', 'RESERVED'].includes(s.status));
      const claimedCount = e.shares.filter((s) => s.status === 'CLAIMED').length;
      const remaining = unclaimed.reduce((a, s) => a + s.sats, 0n);
      // Same derived status as the public view.
      let status: string = e.status;
      if (e.status === 'ACTIVE' && now >= e.expiry) status = 'EXPIRED';
      else if (e.status === 'ACTIVE' && unclaimed.length === 0) status = 'EXHAUSTED';
      return {
        id: e.id,
        slug: e.slug,
        status,
        mode: e.mode as Mode,
        theme: e.theme as Theme,
        message: e.message,
        total: { sats: toNum(e.totalSats), usd: this.price.toUsd(e.totalSats, price) },
        remaining: { sats: toNum(remaining), usd: this.price.toUsd(remaining, price) },
        shares: { total: e.shareCount, claimed: claimedCount, left: unclaimed.length },
        refundedSats: toNum(e.refundedSats),
        expiry: e.expiry,
        createdAt: e.createdAt.toISOString(),
        fundingTxid: e.fundingTxid,
        parentEnvelopeId: e.parentEnvelopeId,
      };
    });

    const claimed: WalletClaim[] = claims.map((c) => ({
      envelopeId: c.envelope.id,
      slug: c.envelope.slug,
      theme: c.envelope.theme as Theme,
      mode: c.envelope.mode as Mode,
      message: c.envelope.message,
      amountSats: toNum(c.amountSats ?? 0n),
      amountUsd: this.price.toUsd(c.amountSats ?? 0n, price),
      claimTxid: c.claimTxid,
      recipientAddress: c.recipientAddress,
      isNewWallet: c.isNewWallet,
      seal:
        c.envelope.sealCategory && c.share?.nftCommitment
          ? { imageUrl: `${api}/seals/${c.envelope.sealCategory}/${c.share.nftCommitment}.png` }
          : null,
      at: c.createdAt.toISOString(),
      passedOn: childByParent.get(c.envelope.id) ?? null,
    }));

    return {
      sent,
      claimed,
      totals: {
        sentCount: sent.length,
        sentSats: sent.reduce((a, e) => a + e.total.sats, 0),
        claimedCount: claimed.length,
        claimedSats: claimed.reduce((a, c) => a + c.amountSats, 0),
        passOnCount: sent.filter((e) => e.parentEnvelopeId).length,
      },
    };
  }
}
