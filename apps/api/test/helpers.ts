// Test harness: real Nest app + real Postgres (hongbao_test) + MockNetworkProvider as "Fulcrum".
import request from 'supertest';
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo, type Output } from 'cashscript';
import { binToHex, hash160, hexToBin, secp256k1, sha256 } from '@bitauth/libauth';
import type { CreateEnvelopeResponse } from '@hongbao/shared';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config/config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TEST_DATABASE_URL } from './global-setup.js';

export const key = (l: string) => sha256.hash(new TextEncoder().encode(`hongbao-api-test-${l}`));
export const pub = (k: Uint8Array) => secp256k1.derivePublicKeyCompressed(k) as Uint8Array;
export const p2pkh = (pk: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pk), 0x88, 0xac]);

// Chipnet cashaddrs of key('sender') and key('treasury').
export const senderPriv = key('sender');
export const sender = p2pkh(pub(senderPriv));
export const SENDER_ADDRESS = 'bchtest:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwgw2cltjwn';
export const TREASURY_ADDRESS = 'bchtest:qrm75mfwuwpw93wnrra2grcnqxtc23dctqfnv2k6fy';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NETWORK: 'CHIPNET',
    DATABASE_URL: TEST_DATABASE_URL,
    GATE_MASTER_SEED: '11'.repeat(32),
    ADMIN_TOKEN: 'a'.repeat(32),
    TREASURY_ADDRESS,
    PUBLIC_API_URL: 'https://api.hongbao.test',
    PRICE_API_URL: 'http://127.0.0.1:9/price', // unreachable → falls back to the seeded price
    ...overrides,
  });
}

export async function makeApp(overrides: Record<string, string> = {}) {
  const provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
  const config = testConfig(overrides);
  const app = await createApp({ config, providerFactory: async () => ({ provider, server: 'mock' }) });
  await app.init();
  const db = app.get(PrismaService);
  return { app, db, provider, config, http: () => request(app.getHttpServer()) };
}

export async function resetDb(db: PrismaService, priceUsd = 200) {
  await db.$executeRawUnsafe(
    'TRUNCATE "Claim", "Share", "Envelope", "Campaign", "Sponsor", "LedgerEntry", "Setting" RESTART IDENTITY CASCADE',
  );
  await db.setting.create({ data: { key: 'price.bchusd', value: String(priceUsd) } });
}

/** A sender UTXO at vout 0 (its txid becomes the stamp category). */
export function addSenderUtxo(provider: MockNetworkProvider, sats = 200_000n, vout = 0) {
  return provider.addUtxo(binToHex(sender), randomUtxo({ satoshis: sats, vout }));
}

/** Build + "broadcast" the funding tx from the API's fundingTemplate, optionally tampered. */
export async function fundFromTemplate(
  provider: MockNetworkProvider,
  res: CreateEnvelopeResponse,
  utxo: Awaited<ReturnType<typeof addSenderUtxo>>,
  tamper: (outs: Output[]) => Output[] = (o) => o,
) {
  const outs: Output[] = tamper(
    res.fundingTemplate.map((o) => ({
      to: hexToBin(o.lockingBytecode),
      amount: BigInt(o.sats),
      ...(o.token && { token: { category: o.token.category, amount: 0n, nft: { capability: 'none' as const, commitment: o.token.nftCommitment } } }),
    })),
  );
  const spent = outs.reduce((a, o) => a + o.amount, 0n);
  const sent = await new TransactionBuilder({ provider })
    .addInput(utxo, new SignatureTemplate(senderPriv).unlockP2PKH())
    .addOutputs(outs)
    .addOutput({ to: sender, amount: utxo.satoshis - spent - 2_000n })
    .send();
  return sent.txid;
}

export function createBody(over: Record<string, unknown> = {}) {
  return {
    senderAddress: SENDER_ADDRESS,
    linkPk: binToHex(pub(key('link'))),
    shareCount: 3,
    mode: 'EQUAL',
    totalSats: 30_000,
    expiry: Math.floor(Date.now() / 1000) + 1800,
    withStamps: false,
    ...over,
  };
}
