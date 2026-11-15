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

export const FEE_RATE = 1n; // sat/byte — Chipnet and mainnet relay minimum
