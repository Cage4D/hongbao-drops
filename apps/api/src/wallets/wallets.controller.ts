import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp } from '../claims/claims.controller.js';
import { CONFIG, type AppConfig } from '../config/config.js';
import { WalletsService } from './wallets.service.js';
import { withLegacySealAlias } from '../common/legacy.js';

@Controller()
export class WalletsController {
  constructor(
    @Inject(WalletsService) private readonly wallets: WalletsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** POST (not GET) so wallet addresses stay out of URLs and access logs. */
  @Post('wallets/activity')
  @HttpCode(200)
  async activity(@Body() body: unknown, @Req() req: Request) {
    const a = await this.wallets.activity(body, clientIp(req, this.config.CLIENT_IP_HEADER));
    return { ...a, claimed: a.claimed.map(withLegacySealAlias) };
  }
}
