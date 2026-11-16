// Environment config, validated once at startup. Secrets are never logged.
import { z } from 'zod';
import { NetworkSchema } from '@hongbao/shared';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const num = z.coerce.number().finite();

const EnvSchema = z
  .object({
    NETWORK: NetworkSchema.default('CHIPNET'),
    DATABASE_URL: z.string().min(1),
    GATE_MASTER_SEED: z.string().regex(/^[0-9a-fA-F]{64,128}$/, 'hex, 32–64 bytes'),
    FULCRUM_URLS: z.string().default(''),
    ADMIN_TOKEN: z.string().min(24),
    KEEPER_TOKEN: z.string().min(24).optional(),
    TREASURY_ADDRESS: z.string().min(10),
    SPONSOR_FEE_BPS: num.int().min(0).max(10_000).default(300),
    ENABLE_STAMPS: bool.default(true),
    PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
    PRICE_API_URL: z.string().url().default('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd'),
    MAX_ENVELOPE_USD: num.positive().default(0.5),
    MAX_ENVELOPE_SATS: num.int().positive().default(200_000),
    MAX_SHARES: num.int().min(1).max(127).default(10),
    MAX_ACTIVE_MAINNET_SATS: num.int().positive().default(600_000),
    DAILY_MAINNET_SATS: num.int().positive().default(400_000),
    MIN_EXPIRY_SECONDS: num.int().min(60).default(600),
    MAX_EXPIRY_SECONDS: num.int().default(30 * 24 * 3600),
    BUDGET_TOTAL_USD: num.positive().default(5),
    PORT: num.int().default(3000),
    /** >0 runs keeper ticks in-process (local dev). Production: external cron → /internal/keeper/tick. */
    KEEPER_INTERVAL_MS: num.int().min(0).default(0),
  })
  .superRefine((c, ctx) => {
    const prefix = c.NETWORK === 'MAINNET' ? 'bitcoincash:' : 'bchtest:';
    if (!c.TREASURY_ADDRESS.startsWith(prefix)) {
      ctx.addIssue({ code: 'custom', path: ['TREASURY_ADDRESS'], message: `must be a ${prefix} address on ${c.NETWORK}` });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema> & { fulcrumHosts: string[] };

const DEFAULT_FULCRUM = {
  CHIPNET: ['chipnet.imaginary.cash', 'chipnet.bch.ninja'],
  MAINNET: ['bch.imaginary.cash', 'fulcrum.greyh.at'],
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Report which keys are wrong, never their values.
    const keys = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${keys}`);
  }
  const c = parsed.data;
  const fulcrumHosts = c.FULCRUM_URLS
    ? c.FULCRUM_URLS.split(',').map((u) => new URL(u.trim()).hostname)
    : [...DEFAULT_FULCRUM[c.NETWORK]];
  return { ...c, fulcrumHosts };
}

/** DI token for the config object. */
export const CONFIG = Symbol('CONFIG');
