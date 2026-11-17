// Sliding-window rate limits in Postgres, so every serverless instance sees the same counts.
// IPs are never stored raw: ipHash = HMAC(server secret, ip).
import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppError } from '../common/app-error.js';
import type { Prisma } from '../generated/prisma/client.js';

export const WINDOW_MS = 10 * 60 * 1000;
export const LIMITS = {
  /** POST /envelopes per IP per hour. */
  create: 20,
  /** POST /claims attempts per IP per envelope per 10 min. */
  claim: 10,
  /** Wrong quiz answers per IP per envelope per 10 min (spec §8.2). */
  wrongAnswer: 5,
  /** Holds per IP per envelope per 10 min. */
  hold: 5,
  /** SSE streams opened per IP per 10 min (review-2 P1-9). */
  stream: 30,
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

  /**
   * Run `fn` holding a per-key advisory lock, so count-then-record can't be raced by parallel
   * requests (review #7). `fn` gets the current count and a `record` function; whatever it records
   * is committed even if the caller then rejects the request.
   */
  async locked<T>(
    key: string,
    windowMs: number,
    fn: (count: number, record: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const count = await tx.rateEvent.count({ where: { key, createdAt: { gte: new Date(Date.now() - windowMs) } } });
      return fn(count, async () => {
        await tx.rateEvent.create({ data: { key } });
      });
    });
  }

  /** Atomic count + record; throws RATE_LIMITED once `limit` events are in the window. */
  async hit(key: string, limit: number, windowMs = WINDOW_MS): Promise<void> {
    const allowed = await this.locked(key, windowMs, async (count, record) => {
      if (count >= limit) return false;
      await record();
      return true;
    });
    if (!allowed) throw new AppError('RATE_LIMITED');
  }
}
