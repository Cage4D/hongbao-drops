// Rebuild an envelope's Contract from saved state, and small tx helpers shared by the commands.
import type { NetworkProvider, TransactionBuilder } from 'cashscript';
import { cashAddressToLockingBytecode, hexToBin, secp256k1 } from '@bitauth/libauth';
import { hongbaoContract, type HongbaoContract } from '@hongbao/contract';
import type { EnvelopeState } from './state.js';

export function envelopeContract(e: EnvelopeState, provider: NetworkProvider): HongbaoContract {
  return hongbaoContract(
    {
      linkPk: secp256k1.derivePublicKeyCompressed(hexToBin(e.linkPrivHex)) as Uint8Array,
      gatePk: secp256k1.derivePublicKeyCompressed(hexToBin(e.gatePrivHex)) as Uint8Array,
      refundLockingBytecode: hexToBin(e.refundLockingBytecodeHex),
      expiry: e.expiry,
      maxFee: BigInt(e.maxFee),
    },
    provider,
  );
}

export function addressToLockingBytecode(address: string): Uint8Array {
  const r = cashAddressToLockingBytecode(address);
  if (typeof r === 'string') throw new Error(`Bad address ${address}: ${r}`);
  return r.bytecode;
}

/** Serialized size in bytes of a fully built (signed) transaction. */
export const txSize = (tb: TransactionBuilder) => tb.build().length / 2;
/**
 * Fee for a measured draft size, with a small margin: the final tx can come out a few bytes larger
 * than the draft (a 10-share seal funding tx was refused at 0.99 sat/B on mainnet, 2026-11-18).
 */
export const feeFor = (size: number) => BigInt(size) * FEE_RATE + BigInt(Math.ceil(size / 50)) + 10n;

export const FEE_RATE = 1n; // sat/byte — Chipnet and mainnet relay minimum
/**
 * Fee to assume while building a draft tx just to measure its size. It must cover ≥ 1 sat/byte of
 * the draft, or CashScript rejects the draft itself: a flat 1,000 sats broke once the script wallet
 * held ~20 coins (~150 bytes per P2PKH input), and a 10-share seal funding tx (~90 bytes per
 * token output) broke the per-input version. Generous on purpose; the real fee is measured.
 */
export const draftFee = (inputs: number, outputs = 0) => BigInt(inputs) * 200n + BigInt(outputs) * 120n + 1_000n;
