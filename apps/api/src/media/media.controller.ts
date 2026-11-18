import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MediaService, type MediaFile } from './media.service.js';
import { AppError } from '../common/app-error.js';
import { LEGACY_MEDIA_PREFIX } from '../common/legacy.js';

const send = (res: Response, f: MediaFile) =>
  res
    .status(200)
    .set({ 'Content-Type': f.contentType, 'Cache-Control': f.cacheControl, 'Access-Control-Allow-Origin': '*' })
    .send(f.body);

@Controller()
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  /** /og/<envelope id or slug>.png */
  @Get('og/:file')
  async og(@Param('file') file: string, @Res() res: Response) {
    const m = /^([A-Za-z0-9]{1,40})\.png$/.exec(file);
    if (!m) throw new AppError('NOT_FOUND');
    send(res, await this.media.ogPng(m[1]!));
  }

  @Get('seals/:category/:file')
  async seal(@Param('category') category: string, @Param('file') file: string, @Res() res: Response) {
    send(res, await this.media.seal(category, file));
  }

  /**
   * Old seal image URLs, as published inside existing BCMR registries (committed on-chain by hash,
   * so they can never be rewritten). Permanent redirect so wallets keep showing those NFTs.
   */
  @Get(`${LEGACY_MEDIA_PREFIX}/:category/:file`)
  legacySeal(@Param('category') category: string, @Param('file') file: string, @Res() res: Response) {
    // Same validation as the real route happens there; just keep the redirect target tidy.
    if (!/^[0-9a-f]{64}$/.test(category) || !/^[A-Za-z0-9._-]{1,80}$/.test(file)) throw new AppError('NOT_FOUND');
    res
      .status(301)
      .set({ Location: `/seals/${category}/${file}`, 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' })
      .end();
  }

  @Get('bcmr/:file')
  async bcmr(@Param('file') file: string, @Res() res: Response) {
    send(res, await this.media.bcmr(file));
  }
}
