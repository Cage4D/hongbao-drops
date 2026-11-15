// Sliding-window rate limits in Postgres, so every serverless instance sees the same counts.
// IPs are never stored raw: ipHash = HMAC(server secret, ip).
import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppError } from '../common/app-error.js';

export const WINDOW_MS = 10 * 60 * 1000;
export const LIMITS = {
  /** POST /claims attempts per IP per envelope per 10 min. */
  claim: 10,
  /** Wrong quiz answers per IP per envelope per 10 min (spec §8.2). */
  wrongAnswer: 5,
  /** Holds per IP per envelope per 10 min. */
  hold: 5,
} as const;

@Injectable()
export class RateLimitService {
  private readonly ipKey: Buffer;

  constructor(
    @Inject(CONFIG) config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
  ) {
    this.ipKey = createHmac('sha256', 'hongbao-ip-hash').update(config.GATE_MASTER_SEED).digest();
  }

  ipHash(ip: string): string {
    return createHmac('sha256', this.ipKey).update(ip).digest('hex').slice(0, 32);
  }

  async count(key: string, windowMs = WINDOW_MS): Promise<number> {
    return this.db.rateEvent.count({ where: { key, createdAt: { gte: new Date(Date.now() - windowMs) } } });
  }

  async record(key: string): Promise<void> {
    await this.db.rateEvent.create({ data: { key } });
  }

  /** Count + record in one call; throws RATE_LIMITED once `limit` events are in the window. */
  async hit(key: string, limit: number, windowMs = WINDOW_MS): Promise<void> {
    if ((await this.count(key, windowMs)) >= limit) throw new AppError('RATE_LIMITED');
    await this.record(key);
  }
}
