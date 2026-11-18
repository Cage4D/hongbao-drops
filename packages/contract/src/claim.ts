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

/**
 * Returns the signed claim tx hex. The share pays its own fee; the claimer gets the rest (`amount`,
 * all outputs). `bchSats` is the part on token-free outputs: what a wallet shows as BCH balance.
 */
export function buildClaimTx(i: ClaimTxInput): { hex: string; fee: bigint; amount: bigint; bchSats: bigint } {
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
  const to = hexToBin(i.recipientLockingBytecode);
  // A seal share pays the seal on a dust output and the rest as plain BCH on a second output to the
  // same recipient: wallets (Paytaca) only count token-free outputs as BCH balance.
  const build = (amount: bigint, bch?: bigint) => {
    const tb = new TransactionBuilder({ provider: i.provider })
      .addInput(utxo, contract.unlock.claim(new SignatureTemplate(i.linkPrivateKey), hexToBin(i.gateSig)))
      .addOutput({ to, amount, ...(token && { token }) });
    if (bch !== undefined) tb.addOutput({ to, amount: bch });
    return tb.build();
  };
  const dust = dustLimit(to.length, token);
  const plainDust = dustLimit(to.length);
  if (sats <= dust) throw new Error(`share of ${sats} sats is too small to claim (dust ${dust})`);
  // Measure with outputs at exactly their dust limits: amounts are always 8 bytes, so the values
  // don't change the size, and measuring never builds a sub-dust output (review #4). (CashScript
  // refuses to build below 1 sat/B, so the full value can't be used either.)
  const measure = (split: boolean) => {
    try {
      return BigInt(build(dust, split ? plainDust : undefined).length / 2) * BigInt(i.feeRate ?? 1);
    } catch (e) {
      // Even measuring at dust pays < 1 sat/B: the share can't cover its own fee.
      if (/fee per byte/i.test((e as Error).message)) return null;
      throw e;
    }
  };
  const maxFee = BigInt(i.constructorArgs.maxFee);
  if (token) {
    const fee = measure(true);
    if (fee !== null && fee <= maxFee && sats - fee - dust >= plainDust) {
      const bch = sats - fee - dust;
      return { hex: build(dust, bch), fee, amount: dust + bch, bchSats: bch };
    }
    // Too small to split: everything rides on the seal output (still a valid claim).
  }
  const fee = measure(false);
  if (fee === null) throw new Error(`share of ${sats} sats is too small to claim (can't cover the fee)`);
  if (fee > maxFee) throw new Error(`fee ${fee} exceeds the envelope's maxFee ${maxFee}`);
  const amount = sats - fee;
  if (amount < dust) throw new Error(`share of ${sats} sats is too small to claim (${amount} after fee < ${dust} dust)`);
  // One output: with a seal, all of it rides on the seal (no plain BCH); without, it is all BCH.
  return { hex: build(amount), fee, amount, bchSats: token ? 0n : amount };
}
