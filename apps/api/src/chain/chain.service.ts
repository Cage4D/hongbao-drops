// Fulcrum access. Uses CashScript's ElectrumNetworkProvider, trying each configured host in order,
// and caches the working provider for the life of the (serverless) instance.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ElectrumNetworkProvider, type NetworkProvider } from 'cashscript';
import type { AppConfig } from '../config/config.js';
import { AppError } from '../common/app-error.js';

/** DI token: tests inject a MockNetworkProvider here. */
export const NETWORK_PROVIDER_FACTORY = Symbol('NETWORK_PROVIDER_FACTORY');
export type ProviderFactory = () => Promise<{ provider: NetworkProvider; server: string }>;

export function electrumProviderFactory(config: AppConfig): ProviderFactory {
  const network = config.NETWORK === 'MAINNET' ? 'mainnet' : 'chipnet';
  return async () => {
    let last: unknown;
    for (const hostname of config.fulcrumHosts) {
      const provider = new ElectrumNetworkProvider(network, { hostname });
      try {
        await provider.getBlockHeight();
        return { provider, server: hostname };
      } catch (e) {
        last = e;
      }
    }
    throw new Error(`no Fulcrum server reachable: ${(last as Error)?.message}`);
  };
}

@Injectable()
export class ChainService {
  private readonly log = new Logger('Chain');
  private current?: Promise<{ provider: NetworkProvider; server: string }>;

  constructor(@Inject(NETWORK_PROVIDER_FACTORY) private readonly factory: ProviderFactory) {}

  private async conn() {
    this.current ??= this.factory().catch((e) => {
      this.current = undefined;
      throw e;
    });
    return this.current;
  }

  /** Run a chain call; on failure reset the connection and surface CHAIN_UNAVAILABLE. */
  async use<T>(fn: (p: NetworkProvider) => Promise<T>): Promise<T> {
    try {
      return await fn((await this.conn()).provider);
    } catch (e) {
      this.log.warn(`chain call failed: ${(e as Error).message}`);
      this.current = undefined;
      throw new AppError('CHAIN_UNAVAILABLE');
    }
  }

  provider(): Promise<NetworkProvider> {
    return this.conn().then((c) => c.provider);
  }

  /** Raw tx hex, or null if the server doesn't know the txid (not broadcast yet). */
  async getRawTransaction(txid: string): Promise<string | null> {
    const { provider } = await this.conn().catch(() => {
      throw new AppError('CHAIN_UNAVAILABLE');
    });
    try {
      return await provider.getRawTransaction(txid);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/not found|No such|unknown|missing|Invalid tx/i.test(msg)) return null;
      this.log.warn(`getRawTransaction failed: ${msg}`);
      this.current = undefined;
      throw new AppError('CHAIN_UNAVAILABLE');
    }
  }

  async status(): Promise<{ ok: boolean; height: number | null; server: string | null }> {
    try {
      const c = await this.conn();
      return { ok: true, height: await c.provider.getBlockHeight(), server: c.server };
    } catch {
      this.current = undefined;
      return { ok: false, height: null, server: null };
    }
  }
}
