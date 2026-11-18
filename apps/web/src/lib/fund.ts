// Flow A (create + fund) and Flow C (pass it on), handoff §4 and §6.
import { hexToBin } from '@bitauth/libauth';
import type { Output } from 'cashscript';
import type { CreateEnvelopeRequest, CreateEnvelopeResponse } from '@hongbao/shared';
import { dustLimit } from '@hongbao/contract';
import { api } from './api';
import { newLinkKey, shareUrl } from './link';
import type { NetCfg } from './network';
import { InsufficientFunds, estimateFee, type WalletAddr, type WalletUtxo, useWallet } from './wallet';

export type FundStep = 'scan' | 'prep' | 'create' | 'sign' | 'confirm';

export type EnvelopeDraft = Omit<CreateEnvelopeRequest, 'senderAddress' | 'linkPk' | 'stampCategory'>;

export interface FundResult {
  created: CreateEnvelopeResponse;
  wif: string;
  url: string;
  txid: string;
}

type Wallet = ReturnType<typeof useWallet>;

const IDENTITY = 546n;
/** Sponsored drops pay 3% (min 546) on top; the exact fee comes back in the template. */
const sponsorFeeEstimate = (sats: number) => BigInt(Math.max(546, Math.ceil(sats * 0.03)));

function pickInputs(first: WalletUtxo, pool: WalletUtxo[], need: bigint, extraOutputs: number): WalletUtxo[] {
  const chosen = [first];
  let sum = first.satoshis;
  const rest = pool.filter((u) => u !== first).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1));
  for (const u of rest) {
    if (sum >= need + estimateFee(chosen.length, extraOutputs)) break;
    chosen.push(u);
    sum += u.satoshis;
  }
  if (sum < need + estimateFee(chosen.length, extraOutputs)) throw new InsufficientFunds(need + estimateFee(chosen.length, extraOutputs), sum);
  return chosen;
}

export async function createAndFund(opts: {
  wallet: Wallet;
  cfg: NetCfg;
  draft: EnvelopeDraft;
  /** Pass it on: the claimed coin (txid:0) that must be spent as input 0. */
  mustSpend?: { txid: string; vout: number };
  onStep: (s: FundStep, note?: string) => void;
  signal?: AbortSignal;
}): Promise<FundResult> {
  const { wallet, cfg, draft, mustSpend, onStep, signal } = opts;
  const withStamps = draft.withStamps !== false;
  const receive0 = wallet.receive0;
  if (!receive0) throw new Error('Connect your wallet first.');

  // 1 — coins
  onStep('scan');
  const all = await wallet.scan();
  const bch = all.filter((u) => !u.token);
  let forced: WalletUtxo | undefined;
  if (mustSpend) {
    forced = all.find((u) => u.txid === mustSpend.txid && u.vout === mustSpend.vout);
    if (!forced)
      throw new Error(
        "We couldn't find your claimed coins in this wallet. Pass it on works from the wallet you claimed into. If you just claimed, wait a few seconds and try again.",
      );
  }
  const stampReturn = forced?.token ? dustLimit(25, forced.token) + 100n : 0n;
  const outCount = draft.shareCount + 4;
  const need =
    BigInt(draft.totalSats) +
    (withStamps ? IDENTITY : 0n) +
    (draft.sponsorToken ? sponsorFeeEstimate(draft.totalSats) : 0n) +
    stampReturn +
    BigInt(40 * draft.shareCount); // stamp outputs are bigger than plain ones
  const available = bch.reduce((s, u) => s + u.satoshis, 0n) + (forced ? forced.satoshis : 0n);
  if (available < need + estimateFee(bch.length + 1, outCount)) {
    // Fail early (before any signature) with a useful number.
    throw new InsufficientFunds(need + estimateFee(Math.max(1, bch.length), outCount), available);
  }

  // 2 — input 0. With stamps it must be a coin at output index 0 (CashTokens genesis rule).
  let first: WalletUtxo | undefined = forced;
  let pool = bch;
  if (!first) {
    if (withStamps) {
      first = bch.filter((u) => u.vout === 0).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
      if (!first) {
        onStep('prep', 'Your wallet needs one quick self-send first (signature 1 of 2).');
        const prep = await wallet.signAndSend(bch, [], receive0, 'Hongbao Drops: prepare a coin for your envelope (sends to yourself)', signal);
        if (!prep.change) throw new Error('Your wallet balance is too small for an envelope.');
        first = { txid: prep.txid, vout: 0, satoshis: prep.change.sats, addr: receive0 };
        pool = [first];
      }
    } else {
      first = [...bch].sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
    }
  }
  if (!first) throw new InsufficientFunds(need, 0n);
  if (signal?.aborted) throw new Error('Cancelled.');

  // 3 — create the envelope on the API
  onStep('create');
  const link = newLinkKey(cfg);
  const created = await api.createEnvelope({
    ...draft,
    senderAddress: receive0.address,
    linkPk: link.pk,
    ...(withStamps && { stampCategory: first.txid }),
  });

  // 4 — build exactly the template, then (pass it on) the old stamp back to its owner, then change
  const outputs: Output[] = created.fundingTemplate.map((o) => ({
    to: hexToBin(o.lockingBytecode),
    amount: BigInt(o.sats),
    ...(o.token && { token: { category: o.token.category, amount: 0n, nft: { capability: 'none' as const, commitment: o.token.nftCommitment } } }),
  }));
  if (forced?.token) {
    outputs.push({ to: forced.addr.lockingBytecode, amount: dustLimit(25, forced.token) + 100n, token: forced.token });
  }
  const outSum = outputs.reduce((s, o) => s + o.amount, 0n);
  const inputs = pickInputs(first, pool, outSum, outputs.length + 1);

  onStep('sign', mustSpend ? 'Approve passing it on in your wallet.' : 'Approve the envelope in your wallet.');
  const { txid } = await wallet.signAndSend(
    inputs,
    outputs,
    receive0,
    `Hongbao Drops: fund a red envelope (${draft.shareCount} share${draft.shareCount === 1 ? '' : 's'})`,
    signal,
  );

  // 5 — tell the API; it checks the tx on-chain (retries while its server catches up)
  onStep('confirm');
  await api.funded(created.id, txid);
  return { created, wif: link.wif, url: shareUrl(created, link.wif), txid };
}

export type { WalletAddr };
