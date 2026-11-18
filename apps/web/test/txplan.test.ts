// Fee planning for wallet-signed txs (src/lib/txplan.ts).
import { describe, expect, it } from 'vitest';
import { MockNetworkProvider, type Output } from 'cashscript';
import { binToHex, encodeCashAddress, hash160, hexToBin } from '@bitauth/libauth';
import { DUST, InsufficientFunds, planChange, txBuilder, type PlanAddr, type PlanUtxo } from '../src/lib/txplan';

const provider = new MockNetworkProvider();
const addr = (seed: number): PlanAddr => {
  const pkh = hash160(Uint8Array.from({ length: 33 }, (_, i) => (i === 0 ? 2 : (seed + i) & 0xff)));
  const lockingBytecode = Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
  return { lockingBytecode, lockingHex: binToHex(lockingBytecode), address: encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: pkh }).address };
};
const me = addr(1);
const coin = (sats: number, n = 0): PlanUtxo => ({ txid: n.toString(16).padStart(64, '0'), vout: 0, satoshis: BigInt(sats), addr: me });
const contract = hexToBin('aa20' + '11'.repeat(32) + '87'); // a P2SH32 share output
const shares = (n: number, sats: number): Output[] => Array.from({ length: n }, () => ({ to: contract, amount: BigInt(sats) }));

/** Fee actually paid vs the signed size (placeholders count their future signature bytes). */
function paysOneSatPerByte(inputs: PlanUtxo[], outputs: Output[]) {
  const change = planChange(provider, inputs, outputs, me);
  const tb = txBuilder(provider, inputs, outputs, me, change);
  const size = tb.getTransactionSize();
  const fee = inputs.reduce((s, u) => s + u.satoshis, 0n) - outputs.reduce((s, o) => s + o.amount, 0n) - (change ?? 0n);
  return { change, size, fee };
}

describe('planChange', () => {
  it('pays >= 1 sat/B for the signed size, with change', () => {
    const r = paysOneSatPerByte([coin(100_000)], shares(5, 4_000));
    expect(r.change).not.toBeNull();
    expect(r.fee).toBeGreaterThanOrEqual(r.size);
    expect(r.fee - r.size).toBeLessThan(5n);
  });

  it('pays >= 1 sat/B when the surplus is just above size + dust (the old draft measured no change output)', () => {
    // Sweep surpluses across the window where the old code drafted without change but then added one.
    for (let surplus = 600; surplus <= 2_000; surplus += 7) {
      const r = paysOneSatPerByte([coin(12_000 + surplus)], shares(3, 4_000));
      expect(r.fee, `surplus ${surplus}`).toBeGreaterThanOrEqual(r.size);
      if (r.change !== null) expect(r.change).toBeGreaterThanOrEqual(DUST);
    }
  });

  it('drops dust change into the fee', () => {
    const r = paysOneSatPerByte([coin(12_000 + 700)], shares(3, 4_000));
    expect(r.change).toBeNull();
    expect(r.fee).toBeGreaterThanOrEqual(r.size);
  });

  it('scales with many inputs (no flat placeholder fee)', () => {
    const inputs = Array.from({ length: 30 }, (_, i) => coin(1_000, i + 1));
    const r = paysOneSatPerByte(inputs, shares(2, 10_000));
    expect(r.size).toBeGreaterThan(30n * 140n);
    expect(r.fee).toBeGreaterThanOrEqual(r.size);
  });

  it('refuses when the inputs cannot cover the outputs and fee', () => {
    expect(() => planChange(provider, [coin(12_100)], shares(3, 4_000), me)).toThrow(InsufficientFunds);
  });
});
