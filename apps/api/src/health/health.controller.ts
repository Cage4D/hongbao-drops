// GET /health — cheap enough for a 1–5 min uptime pinger; also exposes keeper heartbeat (spec §10).
import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthResponse } from '@hongbao/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainService } from '../chain/chain.service.js';
import { PriceService } from '../price/price.service.js';

@Controller()
export class HealthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ChainService) private readonly chain: ChainService,
    @Inject(PriceService) private readonly price: PriceService,
  ) {}

  @Get('health')
  async health(): Promise<HealthResponse> {
    const [db, chain, keeper, priceUsd] = await Promise.all([
      this.db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.chain.status(),
      this.db.setting.findUnique({ where: { key: 'keeper.lastRunAt' } }).catch(() => null),
      this.price.bchUsd().catch(() => null),
    ]);
    return {
      ok: db && chain.ok,
      network: this.config.NETWORK,
      db,
      chain,
      keeper: { lastRunAt: keeper?.value ?? null },
      priceUsd,
      time: new Date().toISOString(),
    };
  }
}
