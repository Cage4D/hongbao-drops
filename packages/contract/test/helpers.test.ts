import { describe, expect, it } from 'vitest';
import { binToHex } from '@bitauth/libauth';
import { gateMessage, hongbaoConstructorArgs, sealCommitment } from '../src/index.js';

const pk = new Uint8Array(33).fill(2);

describe('gateMessage', () => {
  it('is recipient ‖ reversed txid ‖ u32le(vout)', () => {
    const txid = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    const msg = gateMessage(Uint8Array.of(0xaa, 0xbb), txid, 258);
    expect(binToHex(msg)).toBe(
      'aabb' + 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100' + '02010000',
    );
  });

  it('rejects malformed input', () => {
    const txid = '00'.repeat(32);
    expect(() => gateMessage(new Uint8Array(), txid, 0)).toThrow();
    expect(() => gateMessage(Uint8Array.of(1), 'abc', 0)).toThrow();
    expect(() => gateMessage(Uint8Array.of(1), txid, -1)).toThrow();
    expect(() => gateMessage(Uint8Array.of(1), txid, 2 ** 31)).toThrow();
  });
});

describe('sealCommitment', () => {
  it('is u32le(seq) ‖ shareIndex', () => {
    expect(binToHex(sealCommitment(1, 1))).toBe('0100000001');
    expect(binToHex(sealCommitment(0x01020304, 10))).toBe('040302010a');
  });

  it('keeps commitments valid positive VM numbers (shareIndex 1..127)', () => {
    expect(() => sealCommitment(1, 0)).toThrow();
    expect(() => sealCommitment(1, 128)).toThrow();
  });
});

describe('hongbaoConstructorArgs', () => {
  const base = { linkPk: pk, gatePk: pk, refundLockingBytecode: Uint8Array.of(0x51), expiry: 1_800_000_000 };

  it('orders args and defaults maxFee', () => {
    expect(hongbaoConstructorArgs(base)).toEqual([pk, pk, Uint8Array.of(0x51), 1_800_000_000n, 1_000n]);
  });

  it('rejects block-height expiries and bad keys', () => {
    expect(() => hongbaoConstructorArgs({ ...base, expiry: 499_999_999 })).toThrow();
    expect(() => hongbaoConstructorArgs({ ...base, linkPk: new Uint8Array(32) })).toThrow();
  });
});

describe('compiled artifact', () => {
  it('matches contracts/Hongbao.cash (run `pnpm compile` if this fails)', async () => {
    const { compileFile } = await import('cashc');
    const { hongbaoArtifact } = await import('../src/index.js');
    const fresh = compileFile(new URL('../contracts/Hongbao.cash', import.meta.url));
    expect(hongbaoArtifact.bytecode).toBe(fresh.bytecode);
    expect(hongbaoArtifact.compiler.version).toBe(fresh.compiler.version);
  });
});
