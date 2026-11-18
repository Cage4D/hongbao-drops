// Talk to the Hongbao API from Chipnet scripts: JSON calls + "create & fund an envelope".
import { binToHex, generatePrivateKey, hexToBin, secp256k1 } from '@bitauth/libauth';
import { SignatureTemplate, TransactionBuilder, type ElectrumNetworkProvider, type Output, type SpendableUtxo } from 'cashscript';
import type { CreateEnvelopeResponse } from '@hongbao/shared';
import { EXPLORER_TX } from './env.js';
import { walletKey, type KeyPair } from './keys.js';
import { draftFee, feeFor, txSize } from './envelope.js';

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
      // A stalled request hung a mainnet run after its funding tx was broadcast (2026-11-18).
      signal: AbortSignal.timeout(60_000),
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
 * Create an envelope via the API and fund it from the script wallet (seals need a vout-0 input;
 * makes a prep tx when necessary). Returns the API response, the link secret and the funding txid.
 */
export async function createAndFund(
  call: ReturnType<typeof apiClient>,
  provider: ElectrumNetworkProvider,
  over: Record<string, unknown>,
  wallet: KeyPair = walletKey(),
): Promise<{ env: CreateEnvelopeResponse; linkPriv: Uint8Array; fundingTxid: string }> {
  const signer = new SignatureTemplate(wallet.priv);
  const withSeals = over.withSeals !== false;
  // Coins just received via the API (e.g. a claim) may not have reached our Fulcrum server yet.
  let utxos: SpendableUtxo[] = [];
  for (let i = 0; i < 15 && utxos.length === 0; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2_000));
    utxos = (await provider.getUtxos(wallet.address)).filter((u) => !u.token);
  }
  if (utxos.length === 0) throw new Error(`no spendable coins at ${wallet.address} after 30 s`);

  let input0 = utxos.find((u) => u.vout === 0 && u.satoshis > 30_000n);
  if (withSeals && !input0) {
    const total = utxos.reduce((s, u) => s + u.satoshis, 0n);
    const mk = (amt: bigint) => {
      const tb = new TransactionBuilder({ provider });
      for (const u of utxos) tb.addInput(u, signer.unlockP2PKH());
      return tb.addOutput({ to: wallet.lockingBytecode, amount: amt });
    };
    const fee = feeFor(txSize(mk(total - draftFee(utxos.length))));
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
    withSeals,
    ...(withSeals && { sealCategory: input0.txid }),
    ...over,
  });
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  const env = created.body as CreateEnvelopeResponse;
  // Printed before funding: if the run dies after broadcast, POST /envelopes/<id>/funded with the
  // funding txid recovers it.
  console.log(`   created: id ${env.id}, slug ${env.slug}`);

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
  const fee = feeFor(txSize(mk(inSum - outSum - draftFee(inputs.length, outs.length + 1))));
  const sent = await mk(inSum - outSum - fee).send();
  console.log(`   funding tx broadcast: ${sent.txid}`);

  // The API may look the tx up on a different Fulcrum server than the one we broadcast to, so it can
  // briefly report "not found on the network yet". Retry only that case (a wallet-broadcast tx in
  // the frontend hits the same race).
  let funded = await call('POST', `/envelopes/${env.id}/funded`, { txid: sent.txid });
  for (let i = 0; i < 15 && funded.status === 409 && JSON.stringify(funded.body).includes('not found on the network yet'); i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    funded = await call('POST', `/envelopes/${env.id}/funded`, { txid: sent.txid });
  }
  if (funded.status !== 200) throw new Error(`funded failed: ${JSON.stringify(funded.body)}`);
  return { env, linkPriv, fundingTxid: sent.txid };
}
