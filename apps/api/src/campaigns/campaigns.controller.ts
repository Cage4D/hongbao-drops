import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
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

  @Get('stats/global')
  global() {
    return this.campaigns.globalStats();
  }

  @Post('envelopes/:id/cta-click')
  @HttpCode(204)
  async cta(@Param('id') id: string, @Req() req: Request) {
    await this.campaigns.ctaClick(id, clientIp(req, this.config.CLIENT_IP_HEADER));
  }
}
