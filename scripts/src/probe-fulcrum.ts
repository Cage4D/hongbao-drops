// Phase 0 probe (§15.6): which public Fulcrum servers answer over WSS, and do they serve the
// calls we depend on (get_history for fresh-wallet detection, listunspent, headers subscribe)?
// Usage: pnpm --filter @hongbao/scripts probe:fulcrum
import { ElectrumClient } from '@electrum-cash/network';
import { ElectrumWebSocket } from '@electrum-cash/web-socket';

const CANDIDATES: Record<string, string[]> = {
  CHIPNET: ['chipnet.bch.ninja', 'chipnet.imaginary.cash', 'cbch.loping.net'],
  MAINNET: ['bch.imaginary.cash', 'electroncash.de', 'bch.loping.net', 'fulcrum.greyh.at', 'bch.cyberbits.eu'],
};
// Ports: Fulcrum's conventional WSS port is 50004; some operators use others.
const PORTS: Record<string, number> = { 'cbch.loping.net': 62104, 'bch.loping.net': 50004, 'electroncash.de': 60004 };

// Script hash of a well-known P2PKH-burn-ish script; content irrelevant, we only test the method.
const SAMPLE_SCRIPTHASH = '8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161';

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))]);

async function probe(host: string) {
  const port = PORTS[host] ?? 50004;
  const started = Date.now();
  const client = new ElectrumClient('hongbao-probe', '1.5', new ElectrumWebSocket(host, { port, encrypted: true, timeoutInMilliSeconds: 8000 }));
  try {
    await withTimeout(client.connect(), 10_000);
    const connectMs = Date.now() - started;
    const features = (await client.request('server.features')) as Record<string, unknown>;
    const history = await client.request('blockchain.scripthash.get_history', SAMPLE_SCRIPTHASH);
    const utxos = await client.request('blockchain.scripthash.listunspent', SAMPLE_SCRIPTHASH);
    const header = (await client.request('blockchain.headers.get_tip')) as { height?: number } | Error;
    const ok = (r: unknown) => (r instanceof Error ? `ERR ${r.message}` : 'ok');
    console.log(
      `✅ ${host}:${port}  connect=${connectMs}ms  server=${features.server_version}  proto=${features.protocol_max}` +
        `  get_history=${ok(history)} listunspent=${ok(utxos)} tip=${header instanceof Error ? ok(header) : header.height}`,
    );
  } catch (e) {
    console.log(`❌ ${host}:${port}  ${(e as Error).message}`);
  } finally {
    await client.disconnect(true).catch(() => {});
  }
}

for (const [net, hosts] of Object.entries(CANDIDATES)) {
  console.log(`--- ${net}`);
  for (const h of hosts) await probe(h);
}
process.exit(0);
