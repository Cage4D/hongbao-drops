// The heavy half of the wallet layer: WizardConnect, address derivation, coin scanning and signing.
// Loaded on demand by WalletProvider (lib/wallet.tsx), so the landing page doesn't ship it.
//
// Lessons from Phase 2 (handoff §10):
//  - the wallet only gives xpubs: derive addresses ourselves (p2pkh + token-aware z…)
//  - fingerprint = sha256(utf8(receive xpub)), never the xpub itself
//  - sign with broadcast:false, relay-safe serialisation, then broadcast ourselves
//  - pairing can fail silently: show the real state and offer Reconnect
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './relayGuard'; // before any relay connects: spaces out WizardConnect's reconnect loop
import { useWizardConnect } from '@wizardconnect/react';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import type { Output, TransactionBuilder } from 'cashscript';
import { binToHex, encodeCashAddress, encodeTransaction, hash160, sha256 } from '@bitauth/libauth';
import { useNetwork, type NetCfg } from './network';
import { chainProvider } from './chain';
import { planChange, txBuilder } from './txplan';
import { WalletSilent, type EngineValue, type PathName, type SignResult, type WalletAddr, type WalletUtxo } from './wallet';

const PATHS: { name: PathName; child: number; count: number }[] = [
  { name: 'receive', child: 0, count: 20 },
  { name: 'change', child: 1, count: 10 },
];

// Long enough to switch to the wallet app and approve; a wallet that was disconnected in its app
// never answers, so don't keep the user waiting longer than this.
const SIGN_TIMEOUT_MS = 2 * 60_000;

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

export default function WalletEngine({
  report,
  takeConnectRequest,
  openModal,
}: {
  /** Hands the live wallet state to WalletProvider (null on unmount). */
  report: (v: EngineValue | null) => void;
  /** True once if the user pressed Connect before this module had loaded. */
  takeConnectRequest: () => boolean;
  openModal: () => void;
}) {
  const { cfg } = useNetwork();
  const wc = useWizardConnect({ dappName: 'Hongbao Drops', dappIcon: `${location.origin}/favicon.svg` });
  // After a page reload the hook restores the saved session but stays 'connecting' until the wallet
  // app answers, and a phone wallet in the background doesn't (on reconnect the wallet sends no
  // wallet_ready). The manager has already restored the wallet's xpubs from storage, which is all we
  // need for addresses, scanning and claims. So a restored session with keys counts as connected;
  // only signing needs the wallet awake (pending sign requests are re-sent when it comes back).
  // A new pairing never matches: attachRelay() drops the old stored session first.
  const awake = wc.state === 'connected' && !!wc.manager;
  const restored = !!wc.manager && (wc.state === 'connecting' || wc.state === 'reconnecting') && wc.manager.hasPath(0);
  const connected = awake || restored;

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
    if (!addresses.length) throw new Error('Your wallet is not connected. Tap Connect wallet and approve in your wallet.');
    const provider = chainProvider(cfg);
    const results = await Promise.all(addresses.map(async (addr) => ({ addr, utxos: await provider.getUtxos(addr.address) })));
    return results.flatMap(({ addr, utxos }) => utxos.map((u) => ({ ...u, addr })));
  }, [cfg, addresses]);

  const signAndSend = useCallback(
    async (inputs: WalletUtxo[], outputs: Output[], change: WalletAddr, prompt: string, signal?: AbortSignal): Promise<SignResult> => {
      if (!cfg || !wc.manager) throw new Error('Your wallet is not connected.');
      const provider = chainProvider(cfg);
      const changeSats = planChange(provider, inputs, outputs, change);
      const wcObj = txBuilder(provider, inputs, outputs, change, changeSats).generateWcTransactionObject({ broadcast: false, userPrompt: prompt });

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
        // A wallet may report a rejection as an error instead of in the response ("User rejected").
        if (!ctrl.signal.aborted && /reject|denied|declin|cancel/i.test(String((e as Error)?.message ?? e))) {
          throw new Error('You declined in your wallet.');
        }
        if (ctrl.signal.aborted) {
          if (signal?.aborted) throw new Error('Cancelled.');
          // The wallet is gone (most often disconnected in its app, whose disconnect message got
          // lost). Stop showing it as connected: the user connects again with a fresh pairing.
          void wc.disconnect();
          throw new WalletSilent();
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
      if (res.error) throw new Error(/reject|denied|cancel/i.test(String(res.error)) ? 'You declined in your wallet.' : `Your wallet couldn't sign: ${res.error}`);
      const txid = await provider.sendRawTransaction(res.signedTransaction);
      return { txid, change: changeSats === null ? null : { vout: outputs.length, sats: changeSats, addr: change } };
    },
    [cfg, wc.manager, wc.disconnect],
  );

  // A fresh pairing after dropping the old session. The hook refuses connect() while it is still
  // 'connecting' (and its connect callback is bound to that render), so wait for the state to
  // leave connecting/connected, then start the new pairing from the current render.
  // useWizardConnect returns a new object every render: depend on its (stable) members only, or
  // the value reported to WalletProvider changes every render and loops (React error #185).
  const { state: wcState, uri: wcUri, connect: wcConnect, disconnect: wcDisconnect } = wc;
  const [pendingFresh, setPendingFresh] = useState(false);
  useEffect(() => {
    if (!pendingFresh || wcState === 'connecting' || wcState === 'connected') return;
    setPendingFresh(false);
    wcConnect();
  }, [pendingFresh, wcState, wcConnect]);

  const reconnect = useCallback(async () => {
    openModal();
    await wcDisconnect();
    setPendingFresh(true);
  }, [wcDisconnect, openModal]);

  const connect = useCallback(() => {
    openModal();
    // Already connected for real, or a new pairing is already showing its QR: just show the modal.
    if (connected && addresses.length > 0) return;
    if (wcState === 'connecting' && wcUri) return;
    // Restoring a saved session in the background (no QR, waits on a wallet that may never answer),
    // or a session that claims to be connected without addresses: replace it with a fresh pairing.
    if (wcState === 'connecting' || wcState === 'reconnecting' || wcState === 'connected') {
      void reconnect();
      return;
    }
    wcConnect();
  }, [wcState, wcUri, wcConnect, reconnect, connected, addresses.length, openModal]);

  // Connect was pressed while this module was still downloading: do it now.
  const connectRef = useRef(connect);
  connectRef.current = connect;
  useEffect(() => {
    if (takeConnectRequest()) connectRef.current();
  }, [takeConnectRequest]);

  const value = useMemo<EngineValue>(
    () => ({
      state: wc.state,
      walletName: wc.walletName,
      error: wc.error,
      uri: wc.uri,
      qrUri: wc.qrUri,
      connected: connected && addresses.length > 0,
      awake,
      connect,
      disconnect: wc.disconnect,
      reconnect,
      addresses,
      receive0,
      fingerprint,
      scan,
      signAndSend,
    }),
    [wc.state, wc.walletName, wc.error, wc.uri, wc.qrUri, wc.disconnect, connected, awake, addresses, receive0, fingerprint, connect, reconnect, scan, signAndSend],
  );

  useLayoutEffect(() => {
    report(value);
  }, [value, report]);
  useLayoutEffect(() => () => report(null), [report]);
  return null;
}
