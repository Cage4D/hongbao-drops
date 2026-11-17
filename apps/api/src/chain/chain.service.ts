// Fulcrum access. Uses CashScript's ElectrumNetworkProvider, trying each configured host in order,
// and caches the working provider for the life of the (serverless) instance.
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ElectrumNetworkProvider, type NetworkProvider } from 'cashscript';
import { binToHex, decodeTransaction, hexToBin, sha256, type TransactionCommon } from '@bitauth/libauth';
import type { AppConfig } from '../config/config.js';
import { AppError } from '../common/app-error.js';

/** DI token: tests inject a MockNetworkProvider here. */
export const NETWORK_PROVIDER_FACTORY = Symbol('NETWORK_PROVIDER_FACTORY');
export type ProviderFactory = () => Promise<{ provider: NetworkProvider; server: string }>;

/**
 * Optional hooks a test provider (MockNetworkProvider) can carry for what it can't simulate:
 * block times and address history.
 */
export interface ChainTestHooks {
  medianTimePast?: () => Promise<number>;
  history?: (lockingBytecodeHex: string) => Promise<{ tx_hash: string; height: number }[]>;
}

const scripthashOf = (lockingBytecodeHex: string) => binToHex(sha256.hash(hexToBin(lockingBytecodeHex)).reverse());

/**
 * Errors meaning the cached WSS connection is dead (not that the server rejected the request).
 * On Vercel an idle instance's socket gets dropped, and the next request fails with
 * "Unable to send request to a disconnected server" — seen in production, Phase 8.
 */
export const STALE_CONNECTION = /disconnected server|not connected|connection (was )?(closed|lost)|socket hang up|ECONNRESET|EPIPE/i;
const errMsg = (e: unknown) => (e as Error)?.message ?? String(e);

export function electrumProviderFactory(config: AppConfig): ProviderFactory {
  const network = config.NETWORK === 'MAINNET' ? 'mainnet' : 'chipnet';
  return async () => {
    let last: unknown;
    for (const hostname of config.fulcrumHosts) {
      // One persistent WSS connection per instance: the auto-managed mode reconnects (TLS
      // handshake, 1–5 s) on every request, which blew the gate's latency budget on Chipnet.
      const provider = new ElectrumNetworkProvider(network, { hostname, manualConnectionManagement: true });
      try {
        await provider.connect();
        await provider.getBlockHeight();
        return { provider, server: hostname };
      } catch (e) {
        last = e;
        await provider.disconnect().catch(() => {});
      }
    }
    throw new Error(`no Fulcrum server reachable: ${(last as Error)?.message}`);
  };
}

@Injectable()
export class ChainService implements OnApplicationBootstrap {
  private readonly log = new Logger('Chain');
  private current?: Promise<{ provider: NetworkProvider; server: string }>;

  constructor(@Inject(NETWORK_PROVIDER_FACTORY) private readonly factory: ProviderFactory) {}

  /** Open the Fulcrum connection in the background at startup, so the first claim doesn't wait ~5 s. */
  onApplicationBootstrap() {
    this.conn().catch((e) => this.log.warn(`initial Fulcrum connect failed: ${(e as Error).message}`));
  }

  /** Drop the current connection (closing it) so the next call reconnects, possibly to another host. */
  private reset() {
    const old = this.current;
    this.current = undefined;
    old
      ?.then(({ provider }) => (provider instanceof ElectrumNetworkProvider ? provider.disconnect() : undefined))
      .catch(() => {});
  }

  private conn(): Promise<{ provider: NetworkProvider; server: string }> {
    this.current ??= this.factory().catch((e) => {
      this.current = undefined;
      throw e;
    });
    return this.current;
  }

  /**
   * Run `fn` on the cached provider. If the connection turns out to be dead, reconnect (possibly to
   * another host) and run it once more. Any other error is passed through untouched.
   */
  private async withProvider<T>(fn: (p: NetworkProvider) => Promise<T>): Promise<T> {
    const pending = this.conn();
    const first = await pending;
    try {
      return await fn(first.provider);
    } catch (e) {
      if (!STALE_CONNECTION.test(errMsg(e))) throw e;
      this.log.warn(`Fulcrum connection to ${first.server} was stale (${errMsg(e)}); reconnecting`);
      // Only drop it if nobody has replaced it yet (a parallel request may already have reconnected).
      if (this.current === pending) this.reset();
      return fn((await this.conn()).provider);
    }
  }

  /** Run a chain call; on failure reset the connection and surface CHAIN_UNAVAILABLE. */
  async use<T>(fn: (p: NetworkProvider) => Promise<T>): Promise<T> {
    try {
      return await this.withProvider(fn);
    } catch (e) {
      this.log.warn(`chain call failed: ${(e as Error).message}`);
      this.reset();
      throw new AppError('CHAIN_UNAVAILABLE');
    }
  }

  provider(): Promise<NetworkProvider> {
    return this.conn().then((c) => c.provider);
  }

  /** Raw tx hex, or null if the server doesn't know the txid (not broadcast yet). */
  async getRawTransaction(txid: string): Promise<string | null> {
    await this.conn().catch(() => {
      throw new AppError('CHAIN_UNAVAILABLE');
    });
    try {
      return await this.withProvider((p) => p.getRawTransaction(txid));
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/not found|No such|unknown|missing|Invalid tx/i.test(msg)) return null;
      this.log.warn(`getRawTransaction failed: ${msg}`);
      this.reset();
      throw new AppError('CHAIN_UNAVAILABLE');
    }
  }

  /**
   * Has this script ever appeared on-chain (spec §6.2 "fresh wallet" check)? Uses Fulcrum's
   * blockchain.scripthash.get_history. Returns null if the lookup fails or times out — the claim
   * must never be blocked by analytics.
   */
  async hasHistory(lockingBytecodeHex: string, timeoutMs = 1_500): Promise<boolean | null> {
    const lookup = this.withProvider(async (provider) => {
      if (provider instanceof ElectrumNetworkProvider) {
        const scripthash = scripthashOf(lockingBytecodeHex);
        const history = (await provider.performRequest('blockchain.scripthash.get_history', scripthash)) as unknown[];
        return history.length > 0;
      }
      // Test providers: approximate with "has any UTXO".
      return (await provider.getUtxosForLockingBytecode(lockingBytecodeHex)).length > 0;
    });
    lookup.catch(() => {}); // if the timeout wins, a late rejection must not be unhandled (would crash Node)
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((r) => {
      timer = setTimeout(() => {
        this.log.warn(`history lookup timed out after ${timeoutMs} ms`);
        r(null);
      }, timeoutMs);
    });
    try {
      return await Promise.race([lookup, timeout]);
    } catch (e) {
      this.log.warn(`history lookup failed: ${(e as Error).message}`);
      this.reset();
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Broadcast a raw tx. Already-known txs count as success (safe client retries). Node rejections
   * become INVALID_REQUEST with the node's reason; connectivity problems become CHAIN_UNAVAILABLE.
   */
  async broadcast(rawTxHex: string): Promise<string> {
    const txid = binToHex(sha256.hash(sha256.hash(hexToBin(rawTxHex))).reverse());
    try {
      await this.provider();
    } catch {
      throw new AppError('CHAIN_UNAVAILABLE');
    }
    try {
      // A retry after a dead connection is safe: if the first attempt did reach the node, the
      // second gets "already known", which counts as success below.
      await this.withProvider((p) => p.sendRawTransaction(rawTxHex));
      return txid;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (/already known|already in (the )?mempool|txn-already|transaction already in block chain/i.test(msg)) return txid;
      if (/missing ?inputs|missingorspent|txn-mempool-conflict|double spend/i.test(msg)) {
        throw new AppError('INVALID_REQUEST', { reasons: ['this share was already spent'] });
      }
      if (/rejected|failed|non-final|bad-txns|script|dust|fee|scriptsig/i.test(msg)) {
        throw new AppError('INVALID_REQUEST', { reasons: [`network rejected the transaction: ${msg.split('\n')[0]}`] });
      }
      this.log.warn(`broadcast failed: ${msg}`);
      this.reset();
      throw new AppError('CHAIN_UNAVAILABLE');
    }
  }

  /**
   * Median of the last 11 block timestamps. A timestamp-locktime tx (our refundBatch) is only
   * accepted once MTP > locktime, which trails wall-clock by ~1 h (measured on Chipnet, Phase 2).
   */
  async medianTimePast(): Promise<number> {
    return this.use(async (p) => {
      const hooks = p as NetworkProvider & ChainTestHooks;
      if (hooks.medianTimePast) return hooks.medianTimePast();
      if (!(p instanceof ElectrumNetworkProvider)) return Math.floor(Date.now() / 1000);
      const tip = await p.getBlockHeight();
      const res = (await p.performRequest('blockchain.block.headers', tip - 10, 11)) as { hex: string; count: number };
      const bytes = hexToBin(res.hex);
      const times: number[] = [];
      for (let i = 0; i < res.count; i++) {
        const o = i * 80 + 68; // header timestamp: u32 LE at byte 68
        times.push(bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! * 2 ** 24));
      }
      return times.sort((x, y) => x - y)[Math.floor(times.length / 2)]!;
    });
  }

  /** Current UTXOs of a locking bytecode (includes 0-conf). */
  utxos(lockingBytecodeHex: string) {
    return this.use((p) => p.getUtxosForLockingBytecode(lockingBytecodeHex));
  }

  /** Confirmed + mempool history (Electrum: height ≤ 0 means unconfirmed). */
  async history(lockingBytecodeHex: string): Promise<{ tx_hash: string; height: number }[]> {
    return this.use(async (p) => {
      const hooks = p as NetworkProvider & ChainTestHooks;
      if (hooks.history) return hooks.history(lockingBytecodeHex);
      if (!(p instanceof ElectrumNetworkProvider)) return [];
      return (await p.performRequest('blockchain.scripthash.get_history', scripthashOf(lockingBytecodeHex))) as {
        tx_hash: string;
        height: number;
      }[];
    });
  }

  /** Decoded transaction, or null if unknown to the server. */
  async getTransaction(txid: string): Promise<TransactionCommon | null> {
    const raw = await this.getRawTransaction(txid);
    if (!raw) return null;
    const tx = decodeTransaction(hexToBin(raw));
    return typeof tx === 'string' ? null : tx;
  }

  async status(): Promise<{ ok: boolean; height: number | null; server: string | null }> {
    try {
      const c = await this.conn();
      return { ok: true, height: await c.provider.getBlockHeight(), server: c.server };
    } catch {
      this.reset();
      return { ok: false, height: null, server: null };
    }
  }
}
