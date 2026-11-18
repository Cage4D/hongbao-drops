// Link-preview cards, seal artwork and BCMR registries (spec §8.5 "Media, seals").
import { Inject, Injectable } from '@nestjs/common';
import { hexToBin } from '@bitauth/libauth';
import { PrismaService } from '../prisma/prisma.service.js';
import { EnvelopesService } from '../envelopes/envelopes.service.js';
import { AppError } from '../common/app-error.js';
import { ogSvg, OG_WIDTH, type OgInput } from './og.js';
import { sealSvg, type SealInput } from './seal.js';
import { renderPng } from './render.js';

export interface MediaFile {
  body: Buffer | string;
  contentType: string;
  cacheControl: string;
}

/** Seals never change once minted; cards change as shares are claimed. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT = 'public, max-age=60, s-maxage=60';

@Injectable()
export class MediaService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(EnvelopesService) private readonly envelopes: EnvelopesService,
  ) {}

  /** GET /og/:idOrSlug.png — 1200×630 preview card. */
  async ogPng(idOrSlug: string): Promise<MediaFile> {
    const row = await this.db.envelope.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }, select: { id: true, seq: true } });
    if (!row) throw new AppError('NOT_FOUND');
    const v = await this.envelopes.publicView({ id: row.id });
    const input: OgInput = {
      seq: row.seq,
      theme: v.theme,
      status: v.status,
      mode: v.mode,
      message: v.message,
      sponsor: v.sponsor ? { name: v.sponsor.name, brandColor: v.sponsor.brandColor } : null,
      sharesLeft: v.shares.left,
      sharesTotal: v.shares.total,
      remainingUsd: v.status === 'PENDING_FUNDING' ? v.total.usd : v.remaining.usd,
      remainingSats: v.status === 'PENDING_FUNDING' ? v.total.sats : v.remaining.sats,
    };
    const { svg, cjk } = ogSvg(input);
    return { body: await renderPng(svg, OG_WIDTH, cjk), contentType: 'image/png', cacheControl: SHORT };
  }

  /** The envelope that minted a seal category (funded one first: only that one's metadata is real). */
  private async envelopeForCategory(category: string) {
    if (!/^[0-9a-f]{64}$/.test(category)) throw new AppError('NOT_FOUND');
    const env = await this.db.envelope.findFirst({
      where: { sealCategory: category },
      orderBy: [{ fundedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: { campaign: { include: { sponsor: true } } },
    });
    if (!env) throw new AppError('NOT_FOUND');
    return env;
  }

  /** GET /seals/:category/:file — "<commitment>.svg|png" or "collection.svg|png". */
  async seal(category: string, file: string): Promise<MediaFile> {
    const m = /^(collection|[0-9a-f]{10})\.(svg|png)$/.exec(file);
    if (!m) throw new AppError('NOT_FOUND');
    const env = await this.envelopeForCategory(category);
    let index: number | null = null;
    if (m[1] !== 'collection') {
      const c = hexToBin(m[1]!);
      const seq = c[0]! | (c[1]! << 8) | (c[2]! << 16) | (c[3]! * 2 ** 24); // u32le, see sealCommitment()
      index = c[4]!;
      if (seq !== env.seq || index < 1 || index > env.shareCount) throw new AppError('NOT_FOUND');
    }
    const input: SealInput = {
      theme: env.theme,
      seq: env.seq,
      index,
      shareCount: env.shareCount,
      sponsorName: env.campaign?.sponsor.name ?? null,
    };
    const svg = sealSvg(input);
    return m[2] === 'svg'
      ? { body: svg, contentType: 'image/svg+xml; charset=utf-8', cacheControl: IMMUTABLE }
      : { body: await renderPng(svg, 512), contentType: 'image/png', cacheControl: IMMUTABLE };
  }

  /**
   * GET /bcmr/:category.json — the registry bytes committed (by sha256) in the funding tx's
   * OP_RETURN. Served verbatim: re-serialising would change the hash and break wallet validation.
   */
  async bcmr(file: string): Promise<MediaFile> {
    const m = /^([0-9a-f]{64})\.json$/.exec(file);
    if (!m) throw new AppError('NOT_FOUND');
    const env = await this.envelopeForCategory(m[1]!);
    if (!env.bcmrRegistry) throw new AppError('NOT_FOUND');
    return { body: env.bcmrRegistry, contentType: 'application/json; charset=utf-8', cacheControl: env.fundedAt ? IMMUTABLE : SHORT };
  }
}
