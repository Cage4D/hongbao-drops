// BCH/USD (spec §8.1 PriceModule): cached 60 s in memory, last known value persisted in Setting so
// every serverless instance has a fallback when the price API is down.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const TTL_MS = 60_000;
const KEY = 'price.bchusd';

@Injectable()
export class PriceService {
  private readonly log = new Logger('Price');
  private cache?: { usd: number; at: number };
  private inflight?: Promise<number | null>;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
  ) {}

  /** USD per BCH, or null if never known. */
  async bchUsd(): Promise<number | null> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.usd;
    this.inflight ??= this.refresh().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async refresh(): Promise<number | null> {
    try {
      const res = await fetch(this.config.PRICE_API_URL, { signal: AbortSignal.timeout(3_000) });
      const json = (await res.json()) as { 'bitcoin-cash'?: { usd?: number } };
      const usd = json['bitcoin-cash']?.usd;
      if (typeof usd !== 'number' || !(usd > 0)) throw new Error('unexpected price payload');
      this.cache = { usd, at: Date.now() };
      await this.db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: String(usd) }, update: { value: String(usd) } });
      return usd;
    } catch (e) {
      this.log.warn(`price fetch failed, using last known: ${(e as Error).message}`);
      const last = await this.db.setting.findUnique({ where: { key: KEY } }).catch(() => null);
      const usd = last ? Number(last.value) : (this.cache?.usd ?? null);
      if (usd) this.cache = { usd, at: Date.now() - TTL_MS / 2 }; // retry sooner
      return usd;
    }
  }

  /** sats → USD rounded to cents; null when no price is known. */
  async usd(sats: bigint | number): Promise<number | null> {
    const p = await this.bchUsd();
    return p === null ? null : Math.round((Number(sats) / 1e8) * p * 100) / 100;
  }

  toUsd(sats: bigint | number, price: number | null): number | null {
    return price === null ? null : Math.round((Number(sats) / 1e8) * price * 100) / 100;
  }
}
