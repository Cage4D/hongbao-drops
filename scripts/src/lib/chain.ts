// Fulcrum access via CashScript's ElectrumNetworkProvider, trying each host in order. Chipnet unless
// the script runs with --mainnet (see env.ts). Name kept for the many Chipnet-only callers.
import { ElectrumNetworkProvider } from 'cashscript';
import { FULCRUM_HOSTS, NET } from './env.js';

export async function chipnetProvider(): Promise<ElectrumNetworkProvider> {
  let lastError: unknown;
  for (const hostname of FULCRUM_HOSTS) {
    const provider = new ElectrumNetworkProvider(NET, { hostname });
    try {
      await provider.getBlockHeight(); // connectivity check
      return provider;
    } catch (e) {
      lastError = e;
      console.warn(`Fulcrum ${hostname} unavailable: ${(e as Error).message}`);
    }
  }
  throw new Error(`No Fulcrum server reachable: ${(lastError as Error)?.message}`);
}

/** Median-time-past of the tip: a timestamp locktime is only final once MTP > locktime. */
export async function medianTimePast(provider: ElectrumNetworkProvider): Promise<number> {
  const tip = await provider.getBlockHeight();
  const times: number[] = [];
  for (let h = tip - 10; h <= tip; h++) {
    const header = (await provider.performRequest('blockchain.block.header', h)) as string;
    // Block header bytes 68..72 = timestamp (u32 LE).
    times.push(Buffer.from(header, 'hex').readUInt32LE(68));
  }
  return times.sort((a, b) => a - b)[5]!;
}
