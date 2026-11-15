import { Module, type DynamicModule } from '@nestjs/common';
import { CONFIG, loadConfig, type AppConfig } from './config/config.js';
import { PrismaService } from './prisma/prisma.service.js';
import { KeysService } from './keys/keys.service.js';
import { ChainService, NETWORK_PROVIDER_FACTORY, electrumProviderFactory, type ProviderFactory } from './chain/chain.service.js';
import { PriceService } from './price/price.service.js';
import { BudgetService } from './budget/budget.service.js';
import { EnvelopesService } from './envelopes/envelopes.service.js';
import { EnvelopesController } from './envelopes/envelopes.controller.js';
import { HealthController } from './health/health.controller.js';
import { RateLimitService } from './ratelimit/rate-limit.service.js';
import { ClaimsService } from './claims/claims.service.js';
import { ClaimsController } from './claims/claims.controller.js';

export interface AppModuleOptions {
  config?: AppConfig;
  /** Tests pass a MockNetworkProvider-backed factory. */
  providerFactory?: ProviderFactory;
}

@Module({})
export class AppModule {
  static forRoot(opts: AppModuleOptions = {}): DynamicModule {
    const config = opts.config ?? loadConfig();
    return {
      module: AppModule,
      controllers: [EnvelopesController, ClaimsController, HealthController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: NETWORK_PROVIDER_FACTORY, useValue: opts.providerFactory ?? electrumProviderFactory(config) },
        PrismaService,
        KeysService,
        ChainService,
        PriceService,
        BudgetService,
        EnvelopesService,
        RateLimitService,
        ClaimsService,
      ],
    };
  }
}
