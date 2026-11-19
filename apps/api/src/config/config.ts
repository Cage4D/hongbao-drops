// Environment config, validated once at startup. Secrets are never logged.
import { z } from 'zod';
import { binToHex, cashAddressToLockingBytecode } from '@bitauth/libauth';
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
    /** Mint a Hongbao Seal NFT per share (default on). */
    ENABLE_SEALS: bool.default(true),
    PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
    PRICE_API_URL: z.string().url().default('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd'),
    MAX_ENVELOPE_USD: num.positive().default(0.5),
    MAX_ENVELOPE_SATS: num.int().positive().default(200_000),
    MAX_SHARES: num.int().min(1).max(127).default(10),
    MAX_ACTIVE_MAINNET_SATS: num.int().positive().default(600_000),
    DAILY_MAINNET_SATS: num.int().positive().default(400_000),
    MIN_EXPIRY_SECONDS: num.int().min(1).default(600),
    /** Default: 24 h on MAINNET (review-2 Q3, bounds locked funds), 30 days on CHIPNET. */
    MAX_EXPIRY_SECONDS: num.int().positive().optional(),
    BUDGET_TOTAL_USD: num.positive().default(5),
    /**
     * The builder's dedicated demo wallet (§10.1 rule 6). The totals caps (active, daily,
     * BUDGET_TOTAL_USD) and the spend ledger only count envelopes that refund to this wallet, so
     * judges funding envelopes with their own BCH can't use up the $5 budget (review-2 Q1).
     * Required on MAINNET.
     */
    BUDGET_WALLET_ADDRESS: z.string().optional(),
    /**
     * BCH/USD the caps assume when no live or last-known price exists (review-2 P1-4). Deliberately
     * high (≈2.4× the Nov 2026 price) so the USD caps err on the strict side.
     */
    BUDGET_FALLBACK_BCH_USD: num.positive().default(500),
    PORT: num.int().default(3000),
    /** Header carrying the real client IP, set by our host (e.g. x-vercel-forwarded-for). Unset → socket address. */
    CLIENT_IP_HEADER: z.string().optional(),
    /** >0 runs keeper ticks in-process (local dev). Production: external cron → /internal/keeper/tick. */
    KEEPER_INTERVAL_MS: num.int().min(0).default(0),
  })
  .superRefine((c, ctx) => {
    const prefix = c.NETWORK === 'MAINNET' ? 'bitcoincash:' : 'bchtest:';
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!c.TREASURY_ADDRESS.startsWith(prefix)) issue('TREASURY_ADDRESS', `must be a ${prefix} address on ${c.NETWORK}`);
    if (c.BUDGET_WALLET_ADDRESS !== undefined && lockingBytecodeOf(c.BUDGET_WALLET_ADDRESS, prefix) === null) {
      issue('BUDGET_WALLET_ADDRESS', `must be a ${prefix} address on ${c.NETWORK}`);
    }
    for (const u of c.FULCRUM_URLS ? c.FULCRUM_URLS.split(',') : []) {
      let url: URL | null = null;
      try {
        url = new URL(u.trim());
      } catch {
        issue('FULCRUM_URLS', 'must be a comma-separated list of wss://host[:50004] URLs');
        continue;
      }
      // CashScript's provider only takes a hostname and always uses port 50004 (review-2 P2-1).
      if (url.port && url.port !== '50004') issue('FULCRUM_URLS', `port ${url.port} is not supported (only 50004)`);
    }
    if (c.NETWORK === 'MAINNET') {
      if (!c.BUDGET_WALLET_ADDRESS) issue('BUDGET_WALLET_ADDRESS', 'required on MAINNET (the demo wallet the caps protect)');
      if ((c.MAX_EXPIRY_SECONDS ?? 0) > MAINNET_MAX_EXPIRY) issue('MAX_EXPIRY_SECONDS', `at most ${MAINNET_MAX_EXPIRY} on MAINNET`);
      // BCMR URIs are committed on-chain by hash and can never be fixed later (review-2 P2-1).
      const api = new URL(c.PUBLIC_API_URL);
      if (api.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(api.hostname)) {
        issue('PUBLIC_API_URL', 'must be the public https:// URL on MAINNET');
      }
    }
  });

const MAINNET_MAX_EXPIRY = 24 * 3600;

/** Hex locking bytecode of a cashaddr with the expected prefix, or null. */
function lockingBytecodeOf(address: string, prefix: string): string | null {
  if (!address.startsWith(prefix)) return null;
  const r = cashAddressToLockingBytecode(address);
  return typeof r === 'string' ? null : binToHex(r.bytecode);
}

export type AppConfig = Omit<z.infer<typeof EnvSchema>, 'MAX_EXPIRY_SECONDS'> & {
  MAX_EXPIRY_SECONDS: number;
  ENABLE_SEALS: boolean;
  fulcrumHosts: string[];
  /** Locking bytecode (hex) of BUDGET_WALLET_ADDRESS, or null when unset (CHIPNET). */
  budgetLockingBytecode: string | null;
};

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
  const prefix = c.NETWORK === 'MAINNET' ? 'bitcoincash:' : 'bchtest:';
  return {
    ...c,
    MAX_EXPIRY_SECONDS: c.MAX_EXPIRY_SECONDS ?? (c.NETWORK === 'MAINNET' ? MAINNET_MAX_EXPIRY : 30 * 24 * 3600),
    fulcrumHosts,
    budgetLockingBytecode: c.BUDGET_WALLET_ADDRESS ? lockingBytecodeOf(c.BUDGET_WALLET_ADDRESS, prefix) : null,
  };
}


/** DI token for the config object. */
export const CONFIG = Symbol('CONFIG');
