// WizardConnect wallet layer (Paytaca first). Lessons from Phase 2 (handoff §10):
//  - the wallet only gives xpubs: derive addresses ourselves (p2pkh + token-aware z…)
//  - fingerprint = sha256(utf8(receive xpub)), never the xpub itself
//  - sign with broadcast:false, relay-safe serialisation, then broadcast ourselves
//  - pairing can fail silently: show the real state and offer Reconnect
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useWizardConnect, type WizardConnectState } from '@wizardconnect/react';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import { TransactionBuilder, placeholderP2PKHUnlocker, type Output, type Utxo } from 'cashscript';
import { binToHex, encodeCashAddress, encodeTransaction, hash160, sha256 } from '@bitauth/libauth';
import { chainProvider, useNetwork, type NetCfg } from './network';

const PATHS = [
  { name: 'receive', child: 0, count: 20 },
  { name: 'change', child: 1, count: 10 },
] as const;
export type PathName = (typeof PATHS)[number]['name'];

export interface WalletAddr {
  path: PathName;
  index: number;
  lockingBytecode: Uint8Array;
  lockingHex: string;
  address: string;
  tokenAddress: string;
}
export type WalletUtxo = Utxo & { addr: WalletAddr };

/** P2PKH dust: change below this is dropped into the fee. */
const DUST = 546n;
const SIGN_TIMEOUT_MS = 3 * 60_000;

export function deriveAddresses(m: DappConnectionManager, prefix: NetCfg['prefix']): WalletAddr[] {
  const out: WalletAddr[] = [];
  for (const p of PATHS) {
    if (!m.hasPath(p.child)) continue;
    for (let i = 0; i < p.count; i++) {
      const pub = m.getPubkey(p.child, BigInt(i));
      if (!pub) continue;
      const pkh = hash160(pub);
      const lockingBytecode = Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
      out.push({
        path: p.name,
        index: i,
        lockingBytecode,
        lockingHex: binToHex(lockingBytecode),
        address: encodeCashAddress({ prefix, type: 'p2pkh', payload: pkh }).address,
        tokenAddress: encodeCashAddress({ prefix, type: 'p2pkhWithTokens', payload: pkh }).address,
      });
    }
  }
  return out;
}

type WcObj = ReturnType<TransactionBuilder['generateWcTransactionObject']>;

/** Relay-safe form of CashScript's WC object (JSON can't hold BigInt/Uint8Array). */
function toRelayRequest(wc: WcObj) {
  return {
    transaction: binToHex(encodeTransaction(wc.transaction)),
    sourceOutputs: wc.sourceOutputs.map((so) => ({
      outpointTransactionHash: binToHex(so.outpointTransactionHash),
      outpointIndex: so.outpointIndex,
      unlockingBytecode: binToHex(so.unlockingBytecode),
      sequenceNumber: so.sequenceNumber,
      valueSatoshis: `<bigint: ${so.valueSatoshis}n>`,
      lockingBytecode: binToHex(so.lockingBytecode),
      ...(so.token && {
        token: {
          category: binToHex(so.token.category),
          amount: `<bigint: ${so.token.amount}n>`,
          ...(so.token.nft && { nft: { capability: so.token.nft.capability, commitment: binToHex(so.token.nft.commitment) } }),
        },
      }),
    })),
    broadcast: false,
    userPrompt: wc.userPrompt,
  };
}

export class InsufficientFunds extends Error {
  constructor(public needSats: bigint, public haveSats: bigint) {
    super(`Your wallet needs about ${needSats - haveSats} more sats for this.`);
  }
}

/** A rough fee for planning (1 sat/B): ~148 B per P2PKH input, ~60 B per output, plus overhead. */
export const estimateFee = (inputs: number, outputs: number, extraBytes = 0) => BigInt(148 * inputs + 60 * outputs + 20 + extraBytes);

export interface SignResult {
  txid: string;
  /** The change output (last output) if one was added. */
  change: { vout: number; sats: bigint; addr: WalletAddr } | null;
}

interface WalletCtx {
  state: WizardConnectState;
  walletName: string | null;
  error: string | null;
  uri: string | null;
  qrUri: string | null;
  connected: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
  addresses: WalletAddr[];
  receive0: WalletAddr | null;
  fingerprint: string | null;
  scan: () => Promise<WalletUtxo[]>;
  signAndSend: (inputs: WalletUtxo[], outputs: Output[], change: WalletAddr, prompt: string, signal?: AbortSignal) => Promise<SignResult>;
  /** Connect modal (rendered once in App). */
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { cfg } = useNetwork();
  const wc = useWizardConnect({ dappName: 'Hongbao Drops', dappIcon: `${location.origin}/favicon.svg` });
  const [modalOpen, setModalOpen] = useState(false);
  const connected = wc.state === 'connected' && !!wc.manager;

  const addresses = useMemo(
    () => (connected && wc.manager && cfg ? deriveAddresses(wc.manager, cfg.prefix) : []),
    // walletName flips when wallet_ready arrives (xpubs available).
    [connected, wc.manager, cfg, wc.walletName],
  );
  const receive0 = addresses.find((a) => a.path === 'receive' && a.index === 0) ?? null;

  const fingerprint = useMemo(() => {
    if (!connected || !wc.manager) return null;
    const xpub = wc.manager.getSessionPaths().find((p) => p.name === 'receive')?.xpub;
    return xpub ? binToHex(sha256.hash(new TextEncoder().encode(xpub))) : null;
  }, [connected, wc.manager, wc.walletName]);

  const scan = useCallback(async (): Promise<WalletUtxo[]> => {
    if (!cfg) throw new Error('Still loading the network, try again in a second.');
    if (!addresses.length) throw new Error('Your wallet is not connected. Tap Reconnect and approve in Paytaca.');
    const provider = chainProvider(cfg);
    const results = await Promise.all(addresses.map(async (addr) => ({ addr, utxos: await provider.getUtxos(addr.address) })));
    return results.flatMap(({ addr, utxos }) => utxos.map((u) => ({ ...u, addr })));
  }, [cfg, addresses]);

  const signAndSend = useCallback(
    async (inputs: WalletUtxo[], outputs: Output[], change: WalletAddr, prompt: string, signal?: AbortSignal): Promise<SignResult> => {
      if (!cfg || !wc.manager) throw new Error('Your wallet is not connected.');
      const provider = chainProvider(cfg);
      const make = (changeSats: bigint | null) => {
        const tb = new TransactionBuilder({ provider });
        for (const u of inputs) tb.addInput({ ...u, lockingBytecode: u.lockingBytecode ?? u.addr.lockingHex }, placeholderP2PKHUnlocker(u.addr.address));
        tb.addOutputs(outputs);
        if (changeSats !== null) tb.addOutput({ to: change.lockingBytecode, amount: changeSats });
        return tb.generateWcTransactionObject({ broadcast: false, userPrompt: prompt });
      };
      const inSum = inputs.reduce((s, u) => s + u.satoshis, 0n);
      const outSum = outputs.reduce((s, o) => s + o.amount, 0n);
      // Draft with a generous fee (not a flat 1,000: CashScript rejects < 1 sat/B with many inputs).
      const draftFee = BigInt(200 * inputs.length + 1000);
      const draftChange = inSum - outSum - draftFee;
      if (inSum - outSum < estimateFee(inputs.length, outputs.length)) throw new InsufficientFunds(outSum + estimateFee(inputs.length, outputs.length + 1), inSum);
      const withChange = draftChange >= DUST;
      // Placeholder unlockers are empty: add ~107 B per P2PKH input for signature + public key.
      const size = BigInt(encodeTransaction(make(withChange ? draftChange : null).transaction).length + 107 * inputs.length);
      let changeSats: bigint | null = inSum - outSum - size;
      if (changeSats < DUST) {
        if (inSum - outSum < size - 34n) throw new InsufficientFunds(outSum + size, inSum);
        changeSats = null; // dust change goes to the fee
      }
      const wcObj = make(changeSats);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), SIGN_TIMEOUT_MS);
      signal?.addEventListener('abort', () => ctrl.abort());
      let res;
      try {
        res = await wc.manager.signTransaction(
          {
            transaction: toRelayRequest(wcObj) as never,
            inputPaths: inputs.map((u, i) => [i, u.addr.path, u.addr.index]),
          },
          { signal: ctrl.signal },
        );
      } catch (e) {
        if (ctrl.signal.aborted) throw new Error(signal?.aborted ? 'Cancelled.' : 'Paytaca did not answer. Open Paytaca, or tap Reconnect and try again.');
        throw e;
      } finally {
        clearTimeout(timer);
      }
      if (res.error) throw new Error(/reject|denied|cancel/i.test(String(res.error)) ? 'You declined in your wallet.' : `Your wallet couldn't sign: ${res.error}`);
      const txid = await provider.sendRawTransaction(res.signedTransaction);
      return { txid, change: changeSats === null ? null : { vout: outputs.length, sats: changeSats, addr: change } };
    },
    [cfg, wc.manager],
  );

  // A fresh pairing after dropping the old session. The hook refuses connect() while it is still
  // 'connecting' (and its connect callback is bound to that render), so wait for the state to
  // leave connecting/connected, then start the new pairing from the current render.
  const [pendingFresh, setPendingFresh] = useState(false);
  useEffect(() => {
    if (!pendingFresh || wc.state === 'connecting' || wc.state === 'connected') return;
    setPendingFresh(false);
    wc.connect();
  }, [pendingFresh, wc.state, wc]);

  const reconnect = useCallback(async () => {
    setModalOpen(true);
    await wc.disconnect();
    setPendingFresh(true);
  }, [wc]);

  const connect = useCallback(() => {
    setModalOpen(true);
    // Already connected for real, or a new pairing is already showing its QR: just show the modal.
    if (connected && addresses.length > 0) return;
    if (wc.state === 'connecting' && wc.uri) return;
    // Restoring a saved session in the background (no QR, waits on a wallet that may never answer),
    // or a session that claims to be connected without addresses: replace it with a fresh pairing.
    if (wc.state === 'connecting' || wc.state === 'reconnecting' || wc.state === 'connected') {
      void reconnect();
      return;
    }
    wc.connect();
  }, [wc, reconnect, connected, addresses.length]);

  const value: WalletCtx = {
    state: wc.state,
    walletName: wc.walletName,
    error: wc.error,
    uri: wc.uri,
    qrUri: wc.qrUri,
    connected: connected && addresses.length > 0,
    connect,
    disconnect: wc.disconnect,
    reconnect,
    addresses,
    receive0,
    fingerprint,
    scan,
    signAndSend,
    modalOpen,
    openModal: () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}
