import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MediaService, type MediaFile } from './media.service.js';
import { AppError } from '../common/app-error.js';

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

  @Get('stamps/:category/:file')
  async stamp(@Param('category') category: string, @Param('file') file: string, @Res() res: Response) {
    send(res, await this.media.stamp(category, file));
  }

  @Get('bcmr/:file')
  async bcmr(@Param('file') file: string, @Res() res: Response) {
    send(res, await this.media.bcmr(file));
  }
}
