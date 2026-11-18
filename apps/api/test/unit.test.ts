import { describe, expect, it, vi } from 'vitest';
import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { fundingOutputs, hongbaoContract, bcmrRegistryHash } from '@hongbao/contract';
import { verifyFundingTx } from '../src/envelopes/funding-verifier.js';
import { loadConfig } from '../src/config/config.js';
import { normalizeAnswer } from '../src/envelopes/envelopes.service.js';
import { csvCell } from '../src/campaigns/campaigns.service.js';
import { ChainService, GENESIS_HASH, assertGenesis } from '../src/chain/chain.service.js';
import type { NetworkProvider } from 'cashscript';
import { addSenderUtxo, key, p2pkh, pub, sender, senderPriv, testConfig } from './helpers.js';

describe('verifyFundingTx: genesis input', () => {
  it('flags a seal-bearing envelope whose input 0 is not <category>:0', async () => {
    const provider = new MockNetworkProvider();
    const utxo = addSenderUtxo(provider);
    const contract = hongbaoContract(
      { linkPk: pub(key('l')), gatePk: pub(key('g')), refundLockingBytecode: sender, expiry: 1_800_000_000 },
      provider,
    );
    const treasury = p2pkh(pub(key('treasury')));
    const bcmr = { registryHash: bcmrRegistryHash(Uint8Array.of(1)), uris: ['x/y.json'] };
    const outs = fundingOutputs({
      contract,
      shareAmounts: [5_000n],
      seals: { category: utxo.txid, envelopeSeq: 1, identityLockingBytecode: treasury, bcmr },
    });
    const hex = await new TransactionBuilder({ provider })
      .addInput(utxo, new SignatureTemplate(senderPriv).unlockP2PKH())
      .addOutputs(outs)
      .addOutput({ to: sender, amount: 190_000n })
      .send(true);
    const tx = decodeTransaction(hexToBin(hex));
    if (typeof tx === 'string') throw new Error(tx);
    const expected = {
      seq: 1,
      mode: 'LUCKY' as const,
      shareCount: 1,
      totalSats: 5_000n,
      withSeals: true,
      sealCategory: utxo.txid,
      bcmrHash: Buffer.from(bcmr.registryHash).toString('hex'),
      bcmrUri: 'x/y.json',
      sponsorFeeSats: 0n,
      contractLockingBytecode: contract.lockingBytecode,
      treasuryLockingBytecode: Buffer.from(treasury).toString('hex'),
    };
    expect(verifyFundingTx(tx, expected)).toMatchObject({ ok: true });
    const wrong = verifyFundingTx(tx, { ...expected, sealCategory: 'ab'.repeat(32) });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reasons[0]).toMatch(/input 0 must spend/);
  });
});

describe('config', () => {
  it('rejects a treasury address for the wrong network without leaking secrets', () => {
    const seed = 'cd'.repeat(32);
    expect(() =>
      loadConfig({ ...process.env, NETWORK: 'MAINNET', DATABASE_URL: 'x', GATE_MASTER_SEED: seed, ADMIN_TOKEN: 'a'.repeat(32), TREASURY_ADDRESS: 'bchtest:qq' + 'x'.repeat(30) }),
    ).toThrow(/TREASURY_ADDRESS/);
    try {
      loadConfig({ NETWORK: 'CHIPNET', DATABASE_URL: 'x', GATE_MASTER_SEED: 'short', ADMIN_TOKEN: 'a'.repeat(32), TREASURY_ADDRESS: 'bchtest:q' });
    } catch (e) {
      expect((e as Error).message).toMatch(/GATE_MASTER_SEED/);
      expect((e as Error).message).not.toContain('short');
    }
  });

  it('review-2: mainnet guards (demo wallet required, public https API URL, expiry ≤ 24 h, Fulcrum port)', () => {
    const ok = {
      NETWORK: 'MAINNET',
      DATABASE_URL: 'x',
      GATE_MASTER_SEED: '11'.repeat(32),
      ADMIN_TOKEN: 'a'.repeat(32),
      TREASURY_ADDRESS: 'bitcoincash:qrm75mfwuwpw93wnrra2grcnqxtc23dctqdpgd5dwc',
      BUDGET_WALLET_ADDRESS: 'bitcoincash:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwg2cucf9f0',
      PUBLIC_API_URL: 'https://hongbao-drops-api.vercel.app',
    };
    const c = loadConfig(ok);
    expect(c.MAX_EXPIRY_SECONDS).toBe(24 * 3600);
    expect(c.budgetLockingBytecode).toBe(binToHex(sender)); // same key as the test sender
    const err = (over: Record<string, string | undefined>) => {
      try {
        loadConfig({ ...ok, ...over });
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(err({ BUDGET_WALLET_ADDRESS: undefined })).toMatch(/BUDGET_WALLET_ADDRESS: required on MAINNET/);
    expect(err({ BUDGET_WALLET_ADDRESS: 'bchtest:qzkgv8c5ux8l9ngf9md77nrf258ccn9jwgw2cltjwn' })).toMatch(/BUDGET_WALLET_ADDRESS/);
    expect(err({ PUBLIC_API_URL: undefined })).toMatch(/PUBLIC_API_URL/); // localhost default
    expect(err({ PUBLIC_API_URL: 'http://hongbao-drops-api.vercel.app' })).toMatch(/PUBLIC_API_URL/);
    expect(err({ MAX_EXPIRY_SECONDS: String(7 * 24 * 3600) })).toMatch(/MAX_EXPIRY_SECONDS/);
    expect(err({ FULCRUM_URLS: 'wss://bch.imaginary.cash:50002' })).toMatch(/port 50002 is not supported/);
    expect(err({ FULCRUM_URLS: 'wss://bch.imaginary.cash:50004,wss://fulcrum.greyh.at' })).toBe('');
    // Chipnet keeps the long default and needs no demo wallet.
    expect(testConfig().MAX_EXPIRY_SECONDS).toBe(30 * 24 * 3600);
  });

  it('defaults Fulcrum hosts per network', () => {
    expect(testConfig().fulcrumHosts).toEqual(['chipnet.imaginary.cash', 'chipnet.bch.ninja']);
  });
});

describe('quiz normalisation', () => {
  it('trims, lowercases and collapses spaces', () => {
    expect(normalizeAnswer('  Bitcoin \t  CASH ')).toBe('bitcoin cash');
  });
});

describe('ChainService: stale Fulcrum connection (Phase 8, seen in production)', () => {
  const DEAD = "Unable to send request to a disconnected server 'chipnet.imaginary.cash'.";
  // Each factory call hands out the next fake provider; `calls` counts reconnects.
  function service(...providers: Partial<NetworkProvider>[]) {
    let calls = 0;
    const factory = vi.fn(async () => ({ provider: providers[calls++]! as NetworkProvider, server: `s${calls}` }));
    return { chain: new ChainService(factory), factory };
  }

  it('reconnects once and retries a lookup when the cached socket is dead', async () => {
    const { chain, factory } = service(
      { getRawTransaction: async () => Promise.reject(new Error(DEAD)) },
      { getRawTransaction: async () => 'abcd' },
    );
    await expect(chain.getRawTransaction('00'.repeat(32))).resolves.toBe('abcd');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('retries a broadcast after a dead socket; "already known" on the retry still counts as success', async () => {
    const { chain } = service(
      { sendRawTransaction: async () => Promise.reject(new Error(DEAD)) },
      { sendRawTransaction: async () => Promise.reject(new Error('txn-already-known')) },
    );
    await expect(chain.broadcast('00')).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not retry other errors', async () => {
    const tip = vi.fn(async () => Promise.reject(new Error('server busy')));
    const { chain, factory } = service({ getBlockHeight: tip }, { getBlockHeight: async () => 1 });
    await expect(chain.use((p) => p.getBlockHeight())).rejects.toMatchObject({ code: 'CHAIN_UNAVAILABLE' });
    expect(tip).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('parallel requests on a dead socket reconnect only once', async () => {
    const { chain, factory } = service(
      { getBlockHeight: async () => Promise.reject(new Error(DEAD)) },
      { getBlockHeight: async () => 42 },
      { getBlockHeight: async () => -1 }, // must never be used
    );
    const got = await Promise.all([1, 2, 3].map(() => chain.use((p) => p.getBlockHeight())));
    expect(got).toEqual([42, 42, 42]);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('Fulcrum network check (review-2 P1-5)', () => {
  it('accepts a server on the configured network and refuses one on another', () => {
    expect(() => assertGenesis({ genesis_hash: GENESIS_HASH.mainnet }, 'mainnet', 'bch.imaginary.cash')).not.toThrow();
    expect(() => assertGenesis({ genesis_hash: GENESIS_HASH.chipnet }, 'mainnet', 'chipnet.bch.ninja')).toThrow(/not a mainnet server/);
    expect(() => assertGenesis({}, 'chipnet', 'weird.example')).toThrow(/not a chipnet server/);
    expect(() => assertGenesis(null, 'chipnet', 'weird.example')).toThrow();
  });
});

describe('CSV export cells (review-2 test gap)', () => {
  it('neutralises formula injection and quotes separators', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    for (const v of ['+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd']) expect(csvCell(v).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('bchtest:zq4xsj347e')).toBe('bchtest:zq4xsj347e');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });
});
