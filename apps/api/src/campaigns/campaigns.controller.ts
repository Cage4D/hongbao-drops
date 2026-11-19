import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import type { Request, Response } from 'express';
import { CONFIG, type AppConfig } from '../config/config.js';
import { clientIp } from '../claims/claims.controller.js';
import { CampaignsService } from './campaigns.service.js';

@Controller()
export class CampaignsController {
  constructor(
    @Inject(CampaignsService) private readonly campaigns: CampaignsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('sponsors')
  @HttpCode(201)
  createSponsor(@Body() body: unknown, @Req() req: Request) {
    return this.campaigns.createSponsor(body, clientIp(req, this.config.CLIENT_IP_HEADER));
  }

  @Post('campaigns')
  @HttpCode(201)
  createCampaign(@Headers('authorization') auth: string | undefined, @Body() body: unknown) {
    return this.campaigns.createCampaign(auth, body);
  }

  @Get('campaigns/:id/stats')
  stats(@Headers('authorization') auth: string | undefined, @Param('id') id: string) {
    return this.campaigns.stats(auth, id);
  }

  @Get('campaigns/:id/export.csv')
  async csv(@Headers('authorization') auth: string | undefined, @Param('id') id: string, @Res() res: Response) {
    const csv = await this.campaigns.exportCsv(auth, id);
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="hongbao-campaign-${id}.csv"`,
        'Cache-Control': 'no-store',
      })
      .send(csv);
  }

  @Get('campaigns/:id/public')
  publicStats(@Param('id') id: string) {
    return this.campaigns.publicStats(id);
  }

  /** ?since=<ISO time> counts only what happened from then on (e.g. the judging window). */
  @Get('stats/global')
  global(@Query('since') since?: string) {
    if (since === undefined) return this.campaigns.globalStats();
    const at = new Date(since);
    if (Number.isNaN(at.getTime())) throw new AppError('INVALID_REQUEST', { issues: [{ path: 'since', message: 'an ISO date/time, e.g. 2026-11-22T14:00:00Z' }] });
    return this.campaigns.globalStats(at);
  }

  @Post('envelopes/:id/cta-click')
  @HttpCode(204)
  async cta(@Param('id') id: string, @Req() req: Request) {
    await this.campaigns.ctaClick(id, clientIp(req, this.config.CLIENT_IP_HEADER));
  }
}
