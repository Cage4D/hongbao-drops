// Talk to the Hongbao API from Chipnet scripts: JSON calls + "create & fund an envelope".
import { binToHex, generatePrivateKey, hexToBin, secp256k1 } from '@bitauth/libauth';
import { SignatureTemplate, TransactionBuilder, type ElectrumNetworkProvider, type Output, type SpendableUtxo } from 'cashscript';
import type { CreateEnvelopeResponse } from '@hongbao/shared';
import { EXPLORER_TX } from './env.js';
import { walletKey, type KeyPair } from './keys.js';
import { FEE_RATE, txSize } from './envelope.js';

export interface ApiResult {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function apiClient(base: string) {
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text(); // 204 No Content has no JSON body
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

export const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) process.exit(1);
};

/**
 * Create an envelope via the API and fund it from the script wallet (stamps need a vout-0 input;
 * makes a prep tx when necessary). Returns the API response, the link secret and the funding txid.
 */
export async function createAndFund(
  call: ReturnType<typeof apiClient>,
  provider: ElectrumNetworkProvider,
  over: Record<string, unknown>,
  wallet: KeyPair = walletKey(),
): Promise<{ env: CreateEnvelopeResponse; linkPriv: Uint8Array; fundingTxid: string }> {
  const signer = new SignatureTemplate(wallet.priv);
  const withStamps = over.withStamps !== false;
  let utxos: SpendableUtxo[] = (await provider.getUtxos(wallet.address)).filter((u) => !u.token);

  let input0 = utxos.find((u) => u.vout === 0 && u.satoshis > 30_000n);
  if (withStamps && !input0) {
    const total = utxos.reduce((s, u) => s + u.satoshis, 0n);
    const mk = (amt: bigint) => {
      const tb = new TransactionBuilder({ provider });
      for (const u of utxos) tb.addInput(u, signer.unlockP2PKH());
      return tb.addOutput({ to: wallet.lockingBytecode, amount: amt });
    };
    const fee = BigInt(txSize(mk(total - 1_000n))) * FEE_RATE;
    const prep = await mk(total - fee).send();
    console.log(`   prep tx: ${EXPLORER_TX}${prep.txid}`);
    input0 = { txid: prep.txid, vout: 0, satoshis: total - fee, lockingBytecode: binToHex(wallet.lockingBytecode) };
    utxos = [input0];
  }
  input0 ??= utxos[0]!;

  const linkPriv = generatePrivateKey();
  const created = await call('POST', '/envelopes', {
    senderAddress: wallet.address,
    linkPk: binToHex(secp256k1.derivePublicKeyCompressed(linkPriv) as Uint8Array),
    expiry: Math.floor(Date.now() / 1000) + 15 * 60,
    withStamps,
    ...(withStamps && { stampCategory: input0.txid }),
    ...over,
  });
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  const env = created.body as CreateEnvelopeResponse;

  const outs: Output[] = env.fundingTemplate.map((o) => ({
    to: hexToBin(o.lockingBytecode),
    amount: BigInt(o.sats),
    ...(o.token && {
      token: { category: o.token.category, amount: 0n, nft: { capability: 'none' as const, commitment: o.token.nftCommitment } },
    }),
  }));
  const inputs = [input0, ...utxos.filter((u) => u !== input0)];
  const inSum = inputs.reduce((s, u) => s + u.satoshis, 0n);
  const outSum = outs.reduce((s, o) => s + o.amount, 0n);
  const mk = (change: bigint) => {
    const tb = new TransactionBuilder({ provider });
    for (const u of inputs) tb.addInput(u, signer.unlockP2PKH());
    return tb.addOutputs(outs).addOutput({ to: wallet.lockingBytecode, amount: change });
  };
  const fee = BigInt(txSize(mk(inSum - outSum - 1_000n))) * FEE_RATE;
  const sent = await mk(inSum - outSum - fee).send();

  const funded = await call('POST', `/envelopes/${env.id}/funded`, { txid: sent.txid });
  if (funded.status !== 200) throw new Error(`funded failed: ${JSON.stringify(funded.body)}`);
  return { env, linkPriv, fundingTxid: sent.txid };
}
