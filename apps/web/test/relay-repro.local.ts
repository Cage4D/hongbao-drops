// Manual repro (not part of the test suite): count WizardConnect reconnects against an unreachable
// relay for 20 s, with and without the guard. Run: npx tsx test/relay-repro.local.ts [guard]
import { randomBytes } from 'node:crypto';
import { RelayClient } from '@wizardconnect/core';

if (process.argv[2] === 'guard') await import('../src/lib/relayGuard');
const cm = await import(
  // the connection manager isn't exported from the package root
  '../../../node_modules/.pnpm/@wizardconnect+core@0.2.10_typescript@6.0.3/node_modules/@wizardconnect/core/dist/connection-manager.js' as string
);

const client = new RelayClient({
  signerPrivateKey: new Uint8Array(randomBytes(32)),
  explicitRelayUrls: ['ws://127.0.0.1:9'],
  logNetworkActivity: false,
} as never);
let connects = 0;
client.on('disconnect', () => connects++);
const mgr = cm.createConnectionManager(
  client,
  { onConnected: () => {}, onReconnecting: () => {}, onDisconnected: () => {}, onError: () => {} },
  { connected: 'connection', disconnected: 'disconnect', error: 'error' },
  { enableVisibilityHandling: false },
);
mgr.startConnectionLoop();
await new Promise((r) => setTimeout(r, 20_000));
console.log(`${process.argv[2] === 'guard' ? 'with guard   ' : 'without guard'}: ${connects} relay drops/reconnects in 20 s`);
await mgr.cleanup().catch(() => {});
process.exit(0);
