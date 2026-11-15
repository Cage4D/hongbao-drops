// Build the claim tx (spec §6.2 step 4). Used by the frontend, scripts and tests, so all three
// produce exactly what the contract and the API's broadcast checks expect.
import { TransactionBuilder, SignatureTemplate, type NetworkProvider } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import { hongbaoContract } from './hongbao.js';

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
  const size = BigInt(build(sats - 1_000n).length / 2);
  const fee = size * BigInt(i.feeRate ?? 1);
  const maxFee = BigInt(i.constructorArgs.maxFee);
  if (fee > maxFee) throw new Error(`fee ${fee} exceeds the envelope's maxFee ${maxFee}`);
  const amount = sats - fee;
  return { hex: build(amount), fee, amount };
}
