// §10.1 budget caps — enforced server-side on MAINNET only (Chipnet coins are free).
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceService } from '../price/price.service.js';
import { AppError } from '../common/app-error.js';

/** Unfunded mainnet envelopes count against the caps for this long (then they're abandoned). */
const PENDING_COUNTS_FOR_MS = 60 * 60 * 1000;

@Injectable()
export class BudgetService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PriceService) private readonly price: PriceService,
  ) {}

  /** Throws BUDGET_CAP (422) with a machine-readable `cap` when a new envelope would break a limit. */
  async assertCanCreate(totalSats: bigint, shareCount: number): Promise<void> {
    if (this.config.NETWORK !== 'MAINNET') return;
    const c = this.config;
    if (shareCount > c.MAX_SHARES) throw new AppError('BUDGET_CAP', { cap: 'MAX_SHARES', limit: c.MAX_SHARES });

    const price = await this.price.bchUsd();
    if (price !== null) {
      const usd = (Number(totalSats) / 1e8) * price;
      if (usd > c.MAX_ENVELOPE_USD) throw new AppError('BUDGET_CAP', { cap: 'MAX_ENVELOPE_USD', limit: c.MAX_ENVELOPE_USD });
    }
    // Always also apply the sats cap: it's the fallback when the price is unknown, and a backstop.
    if (totalSats > BigInt(c.MAX_ENVELOPE_SATS)) {
      throw new AppError('BUDGET_CAP', { cap: 'MAX_ENVELOPE_SATS', limit: c.MAX_ENVELOPE_SATS });
    }

    const since = new Date(Date.now() - PENDING_COUNTS_FOR_MS);
    const active = await this.db.envelope.aggregate({
      _sum: { totalSats: true },
      where: {
        network: 'MAINNET',
        OR: [{ status: 'ACTIVE' }, { status: 'PENDING_FUNDING', createdAt: { gte: since } }],
      },
    });
    if ((active._sum.totalSats ?? 0n) + totalSats > BigInt(c.MAX_ACTIVE_MAINNET_SATS)) {
      throw new AppError('BUDGET_CAP', { cap: 'MAX_ACTIVE_MAINNET_SATS', limit: c.MAX_ACTIVE_MAINNET_SATS });
    }

    const day = await this.db.envelope.aggregate({
      _sum: { totalSats: true },
      where: {
        network: 'MAINNET',
        createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
        OR: [{ status: { not: 'PENDING_FUNDING' } }, { createdAt: { gte: since } }],
      },
    });
    if ((day._sum.totalSats ?? 0n) + totalSats > BigInt(c.DAILY_MAINNET_SATS)) {
      throw new AppError('BUDGET_CAP', { cap: 'DAILY_MAINNET_SATS', limit: c.DAILY_MAINNET_SATS });
    }
  }
}
