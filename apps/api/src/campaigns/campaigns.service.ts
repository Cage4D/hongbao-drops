// Sponsors, campaigns and the analytics that sell them (spec §4, §8.5 "Sponsors & analytics").
//
// Metric definitions (also in @hongbao/shared CampaignFunnel):
//   claims          BROADCAST/CONFIRMED claims of the campaign's FUNDED envelopes
//   fresh           recipient had no on-chain history before the claim (Fulcrum get_history)
//   activated       fresh AND (claimed coins moved within 7 days OR claimer passed it on — keeper)
//   activatedNotFarm activated AND not flagged as a suspected farm   ← headline denominator
//   spent           claimed share sats (value that left the sponsor, incl. the claim fee each share
//                   paid) + sponsor fees. Locked/refunded coins are NOT spend: they go back.
//   cost per activated new wallet = spentUsd / activatedNotFarm
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { binToHex, sha256 } from '@bitauth/libauth';
import {
  CreateCampaignRequestSchema,
  CreateSponsorRequestSchema,
  type CampaignEnvelopeStats,
  type CampaignStats,
  type CreateCampaignResponse,
  type CreateSponsorResponse,
  type GlobalStats,
  type PublicCampaignStats,
} from '@hongbao/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceService } from '../price/price.service.js';
import { RateLimitService } from '../ratelimit/rate-limit.service.js';
import { AppError } from '../common/app-error.js';
import { validate } from '../common/validate.js';
import { toNum } from '../common/bigint.js';
import type { Sponsor } from '../generated/prisma/client.js';

const CLAIMED = { in: ['BROADCAST', 'CONFIRMED'] as ('BROADCAST' | 'CONFIRMED')[] };
const hashToken = (token: string) => binToHex(sha256.hash(new TextEncoder().encode(token)));
const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class CampaignsService {
  private globalCache?: { at: number; value: GlobalStats };

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PriceService) private readonly price: PriceService,
    @Inject(RateLimitService) private readonly rate: RateLimitService,
  ) {}

  // ------------------------------------------------------------------ sponsors & auth

  async createSponsor(body: unknown, ip: string): Promise<CreateSponsorResponse> {
    const req = validate(CreateSponsorRequestSchema, body);
    await this.rate.hit(`sponsor:${this.rate.ipHash(ip)}`, 5, 3600_000);
    const sponsorToken = `hbs_${randomBytes(32).toString('base64url')}`;
    const s = await this.db.sponsor.create({
      data: {
        name: req.name,
        logoUrl: req.logoUrl ?? null,
        brandColor: req.brandColor ?? null,
        ctaLabel: req.ctaLabel ?? null,
        ctaUrl: req.ctaUrl ?? null,
        adminToken: hashToken(sponsorToken),
      },
    });
    return { sponsorId: s.id, sponsorToken };
  }

  /** `Authorization: Bearer hbs_…` → sponsor, or 401. */
  async authenticate(authorization: string | undefined): Promise<Sponsor> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
    if (!token) throw new AppError('UNAUTHORIZED');
    const sponsor = await this.db.sponsor.findUnique({ where: { adminToken: hashToken(token) } });
    if (!sponsor) throw new AppError('UNAUTHORIZED');
    return sponsor;
  }

  async createCampaign(authorization: string | undefined, body: unknown): Promise<CreateCampaignResponse> {
    const sponsor = await this.authenticate(authorization);
    const { name } = validate(CreateCampaignRequestSchema, body);
    const c = await this.db.campaign.create({ data: { sponsorId: sponsor.id, name } });
    return { campaignId: c.id };
  }

  /** A sponsor may only see its own campaigns; others look like they don't exist. */
  private async ownedCampaign(authorization: string | undefined, campaignId: string) {
    const sponsor = await this.authenticate(authorization);
    const c = await this.db.campaign.findUnique({ where: { id: campaignId } });
    if (!c || c.sponsorId !== sponsor.id) throw new AppError('NOT_FOUND');
    return c;
  }

  // ------------------------------------------------------------------ stats

  async stats(authorization: string | undefined, campaignId: string): Promise<CampaignStats> {
    await this.ownedCampaign(authorization, campaignId);
    return this.computeStats(campaignId);
  }

  /** Shareable proof of reach: aggregate numbers + public txids, no addresses or fingerprints. */
  async publicStats(campaignId: string): Promise<PublicCampaignStats> {
    return this.computeStats(campaignId);
  }

  private async computeStats(campaignId: string): Promise<CampaignStats> {
    const campaign = await this.db.campaign.findUnique({ where: { id: campaignId }, include: { sponsor: true } });
    if (!campaign) throw new AppError('NOT_FOUND');
    const envs = await this.db.envelope.findMany({
      // FAILED = the funding tx vanished: its fee was never really paid (review-2 P1-14).
      where: { campaignId, fundedAt: { not: null }, status: { not: 'FAILED' } },
      include: { shares: true, claims: { where: { status: CLAIMED } } },
      orderBy: { fundedAt: 'asc' },
    });
    const price = await this.price.bchUsd();
    const usd = (sats: bigint) => this.price.toUsd(sats, price);

    const claims = envs.flatMap((e) => e.claims);
    const fresh = claims.filter((c) => c.isNewWallet === true);
    const activated = fresh.filter((c) => c.activatedWithin7d === true);
    const activatedNotFarm = activated.filter((c) => !c.suspectedFarm);
    const shares = envs.flatMap((e) => e.shares);
    const givenAway = shares.filter((s) => s.status === 'CLAIMED').reduce((a, s) => a + s.sats, 0n);
    const fees = envs.reduce((a, e) => a + e.sponsorFeeSats, 0n);
    const spent = givenAway + fees;
    const spentUsd = usd(spent);
    const locked = shares.filter((s) => ['AVAILABLE', 'HELD', 'RESERVED'].includes(s.status)).reduce((a, s) => a + s.sats, 0n);
    const refunded = envs.reduce((a, e) => a + e.refundedSats, 0n);
    const ctaClicks = envs.reduce((a, e) => a + e.ctaClicks, 0);

    // Pass-it-on reach: funded descendants (any depth) of the campaign's envelopes.
    let frontier = envs.map((e) => e.id);
    let passOn = 0;
    let descendantClaims = 0;
    for (let depth = 0; frontier.length && depth < 50; depth++) {
      const kids = await this.db.envelope.findMany({
        where: { parentEnvelopeId: { in: frontier }, fundedAt: { not: null }, status: { not: 'FAILED' } },
        select: { id: true, _count: { select: { claims: { where: { status: CLAIMED } } } } },
      });
      passOn += kids.length;
      descendantClaims += kids.reduce((a, k) => a + k._count.claims, 0);
      frontier = kids.map((k) => k.id);
    }

    const perEnvelope: CampaignEnvelopeStats[] = envs.map((e) => {
      const f = e.claims.filter((c) => c.isNewWallet === true);
      return {
        id: e.id,
        slug: e.slug,
        status: e.status,
        fundingTxid: e.fundingTxid,
        totalSats: toNum(e.totalSats),
        shareCount: e.shareCount,
        claims: e.claims.length,
        freshWallets: f.length,
        activatedNotFarm: f.filter((c) => c.activatedWithin7d === true && !c.suspectedFarm).length,
        ctaClicks: e.ctaClicks,
      };
    });

    return {
      campaignId,
      name: campaign.name,
      sponsor: { name: campaign.sponsor.name, logoUrl: campaign.sponsor.logoUrl, brandColor: campaign.sponsor.brandColor },
      claims: claims.length,
      freshWallets: fresh.length,
      activatedWallets: activated.length,
      activatedNotFarm: activatedNotFarm.length,
      pendingActivation: fresh.filter((c) => c.activatedWithin7d === null).length,
      suspectedFarms: claims.filter((c) => c.suspectedFarm).length,
      givenAwaySats: toNum(givenAway),
      givenAwayUsd: usd(givenAway),
      feesSats: toNum(fees),
      spentSats: toNum(spent),
      spentUsd,
      feesUsd: usd(fees),
      lockedSats: toNum(locked),
      lockedUsd: usd(locked),
      refundedSats: toNum(refunded),
      refundedUsd: usd(refunded),
      priceUsd: price,
      costPerActivatedNewWalletUsd: spentUsd !== null && activatedNotFarm.length ? round2(spentUsd / activatedNotFarm.length) : null,
      costPerFreshWalletUsd: spentUsd !== null && fresh.length ? round2(spentUsd / fresh.length) : null,
      ctaClicks,
      ctr: claims.length ? round2(ctaClicks / claims.length) : null,
      passOnEnvelopes: passOn,
      totalReach: claims.length + descendantClaims,
      perEnvelope,
      fundingTxids: envs.map((e) => e.fundingTxid!),
      claimTxids: claims.map((c) => c.claimTxid!).filter(Boolean),
      refundTxids: [...new Set(shares.filter((s) => s.status === 'REFUNDED' && s.spendTxid).map((s) => s.spendTxid!))],
      generatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------ CSV export (sponsor only)

  async exportCsv(authorization: string | undefined, campaignId: string): Promise<string> {
    await this.ownedCampaign(authorization, campaignId);
    const rows = await this.db.claim.findMany({
      where: { status: CLAIMED, envelope: { campaignId, fundedAt: { not: null } } },
      include: { envelope: { select: { slug: true } }, share: { select: { index: true, outpointTxid: true, outpointIndex: true, sats: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const header = [
      'envelope_slug', 'claimed_at', 'recipient_address', 'share_index', 'share_outpoint', 'share_sats', 'received_sats',
      'claim_txid', 'status', 'fresh_wallet', 'activated_within_7d', 'suspected_farm', 'farm_reasons', 'wallet_fingerprint',
    ];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Quote everything that could break a row; neutralise spreadsheet formula injection.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = rows.map((c) =>
      [
        c.envelope.slug,
        c.createdAt.toISOString(),
        c.recipientAddress,
        c.share?.index,
        c.share ? `${c.share.outpointTxid}:${c.share.outpointIndex}` : '',
        c.share?.sats,
        c.amountSats,
        c.claimTxid,
        c.status,
        c.isNewWallet,
        c.activatedWithin7d,
        c.suspectedFarm,
        c.farmReasons.join('|'),
        c.walletFingerprint,
      ]
        .map(cell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n') + '\n';
  }

  // ------------------------------------------------------------------ global stats

  /** Landing page + pitch numbers. Cached 30 s per instance. */
  async globalStats(): Promise<GlobalStats> {
    if (this.globalCache && Date.now() - this.globalCache.at < 30_000) return this.globalCache.value;
    const [envelopes, claims, fresh, activated, gifted, passOn, price] = await Promise.all([
      this.db.envelope.count({ where: { fundedAt: { not: null } } }),
      this.db.claim.count({ where: { status: CLAIMED } }),
      this.db.claim.count({ where: { status: CLAIMED, isNewWallet: true } }),
      this.db.claim.count({ where: { status: CLAIMED, isNewWallet: true, activatedWithin7d: true } }),
      this.db.share.aggregate({ _sum: { sats: true }, where: { status: 'CLAIMED' } }),
      this.db.envelope.count({ where: { fundedAt: { not: null }, parentEnvelopeId: { not: null } } }),
      this.price.bchUsd(),
    ]);
    const giftedSats = gifted._sum.sats ?? 0n;
    const value: GlobalStats = {
      envelopes,
      claims,
      newWalletsOnboarded: fresh,
      activatedNewWallets: activated,
      bchGiftedSats: toNum(giftedSats),
      bchGiftedUsd: this.price.toUsd(giftedSats, price),
      passOnEnvelopes: passOn,
      generatedAt: new Date().toISOString(),
    };
    this.globalCache = { at: Date.now(), value };
    return value;
  }

  // ------------------------------------------------------------------ CTA clicks

  /** Counts at most one click per IP per envelope per hour, so the number can't be pumped. Always 204. */
  async ctaClick(envelopeId: string, ip: string): Promise<void> {
    const env = await this.db.envelope.findUnique({ where: { id: envelopeId }, select: { id: true } });
    if (!env) throw new AppError('NOT_FOUND');
    await this.rate.locked(`cta:${env.id}:${this.rate.ipHash(ip)}`, 3600_000, async (count, record) => {
      if (count > 0) return;
      await record();
      await this.db.envelope.update({ where: { id: env.id }, data: { ctaClicks: { increment: 1 } } });
    });
  }
}
