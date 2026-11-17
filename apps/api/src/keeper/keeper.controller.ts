// POST /internal/keeper/tick — called every minute by an external cron (cron-job.org) and daily
// by Vercel Cron as a backstop. Bearer KEEPER_TOKEN; disabled (404) when no token is configured.
import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { AppError } from '../common/app-error.js';
import { KeeperService } from './keeper.service.js';

export function bearerMatches(header: string | undefined, token: string | undefined): boolean {
  if (!token || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Controller()
export class KeeperController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(KeeperService) private readonly keeper: KeeperService,
  ) {}

  // POST from the external per-minute cron (cron-job.org).
  @Post('internal/keeper/tick')
  @HttpCode(200)
  tick(@Headers('authorization') auth?: string) {
    return this.run(auth);
  }

  // GET from Vercel Cron (daily backstop), which sends `Authorization: Bearer $CRON_SECRET` — set
  // KEEPER_TOKEN to the same value. A separate handler: NestJS keeps only one HTTP method per
  // handler, so stacking @Get on the POST handler silently registered POST only (review-2 P1-8).
  @Get('internal/keeper/tick')
  tickFromVercelCron(@Headers('authorization') auth?: string) {
    return this.run(auth);
  }

  private run(auth: string | undefined) {
    if (!this.config.KEEPER_TOKEN) throw new AppError('NOT_FOUND');
    if (!bearerMatches(auth, this.config.KEEPER_TOKEN)) throw new AppError('UNAUTHORIZED');
    return this.keeper.tick();
  }
}
