// Build the claim tx (spec §6.2 step 4). Used by the frontend, scripts and tests, so all three
// produce exactly what the contract and the API's broadcast checks expect.
import { TransactionBuilder, SignatureTemplate, type NetworkProvider } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import { hongbaoContract } from './hongbao.js';
import { dustLimit } from './dust.js';

export interface ClaimTxInput {
  provider: NetworkProvider;
  constructorArgs: { linkPk: string; gatePk: string; refundLockingBytecode: string; expiry: number; maxFee: number };
  share: { outpointTxid: string; outpointIndex: number; sats: number | bigint; tokenCategory: string | null; nftCommitment: string | null };
  recipientLockingBytecode: string;
  /** The link secret from the URL fragment. */
  linkPrivateKey: Uint8Array;
  gateSig: string;
  /** sat/byte, default 1. */
  feeRate?: number;
}

/** Returns the signed claim tx hex. The share pays its own fee; the claimer gets the rest. */
export function buildClaimTx(i: ClaimTxInput): { hex: string; fee: bigint; amount: bigint } {
  const contract = hongbaoContract(
    {
      linkPk: hexToBin(i.constructorArgs.linkPk),
      gatePk: hexToBin(i.constructorArgs.gatePk),
      refundLockingBytecode: hexToBin(i.constructorArgs.refundLockingBytecode),
      expiry: i.constructorArgs.expiry,
      maxFee: BigInt(i.constructorArgs.maxFee),
    },
    i.provider,
  );
  const sats = BigInt(i.share.sats);
  const token =
    i.share.tokenCategory && i.share.nftCommitment !== null
      ? { category: i.share.tokenCategory, amount: 0n, nft: { capability: 'none' as const, commitment: i.share.nftCommitment } }
      : undefined;
  const utxo = {
    txid: i.share.outpointTxid,
    vout: i.share.outpointIndex,
    satoshis: sats,
    lockingBytecode: contract.lockingBytecode,
    ...(token && { token }),
  };
  const build = (amount: bigint) =>
    new TransactionBuilder({ provider: i.provider })
      .addInput(utxo, contract.unlock.claim(new SignatureTemplate(i.linkPrivateKey), hexToBin(i.gateSig)))
      .addOutput({ to: hexToBin(i.recipientLockingBytecode), amount, ...(token && { token }) })
      .build();
  // Measure with the output at exactly the dust limit: the amount is always 8 bytes, so the value
  // doesn't change the size, and measuring never builds a sub-dust output (review #4). (CashScript
  // refuses to build below 1 sat/B, so the full value can't be used either.)
  const dust = dustLimit(i.recipientLockingBytecode.length / 2, token);
  if (sats <= dust) throw new Error(`share of ${sats} sats is too small to claim (dust ${dust})`);
  let measured: string;
  try {
    measured = build(dust);
  } catch (e) {
    // Even measuring at dust pays < 1 sat/B: the share can't cover its own fee.
    if (/fee per byte/i.test((e as Error).message)) throw new Error(`share of ${sats} sats is too small to claim (can't cover the fee)`);
    throw e;
  }
  const size = BigInt(measured.length / 2);
  const fee = size * BigInt(i.feeRate ?? 1);
  const maxFee = BigInt(i.constructorArgs.maxFee);
  if (fee > maxFee) throw new Error(`fee ${fee} exceeds the envelope's maxFee ${maxFee}`);
  const amount = sats - fee;
  if (amount < dust) throw new Error(`share of ${sats} sats is too small to claim (${amount} after fee < ${dust} dust)`);
  return { hex: build(amount), fee, amount };
}
