// Wallet context (the light half). Every component reads the wallet through useWallet(); the heavy
// half (WizardConnect, cashscript, libauth: lib/walletEngine.tsx) is its own chunk, loaded only
// when someone presses Connect wallet, or in the background when a saved wallet session exists
// (right away on inner pages, after first paint on the landing page). Until then useWallet()
// returns a "not connected" stand-in whose connect() loads the engine and then connects.
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WizardConnectState } from '@wizardconnect/react';
import type { Output, Utxo } from 'cashscript';

export type PathName = 'receive' | 'change';

export interface WalletAddr {
  path: PathName;
  index: number;
  lockingBytecode: Uint8Array;
  lockingHex: string;
  address: string;
  tokenAddress: string;
}
export type WalletUtxo = Utxo & { addr: WalletAddr };

export interface SignResult {
  txid: string;
  /** The change output (last output) if one was added. */
  change: { vout: number; sats: bigint; addr: WalletAddr } | null;
}

/** What the engine provides once loaded. */
export interface EngineValue {
  state: WizardConnectState;
  walletName: string | null;
  error: string | null;
  uri: string | null;
  qrUri: string | null;
  connected: boolean;
  /** The wallet app is answering right now (signing works). False while a restored session waits for it. */
  awake: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
  addresses: WalletAddr[];
  receive0: WalletAddr | null;
  fingerprint: string | null;
  scan: () => Promise<WalletUtxo[]>;
  signAndSend: (inputs: WalletUtxo[], outputs: Output[], change: WalletAddr, prompt: string, signal?: AbortSignal) => Promise<SignResult>;
}

interface WalletCtx extends EngineValue {
  /** Connect modal (rendered once in Layout). */
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);
const Engine = lazy(() => import('./walletEngine'));

/** WizardConnect keeps its session under this localStorage key (its default). */
const SESSION_KEY = 'wizardconnect-session';
const hasSavedSession = () => {
  try {
    return !!localStorage.getItem(SESSION_KEY);
  } catch {
    return false;
  }
};

const notConnected = () => Promise.reject(new Error('Your wallet is not connected. Tap Connect wallet and approve in your wallet.'));

export function WalletProvider({ children }: { children: ReactNode }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [engine, setEngine] = useState<EngineValue | null>(null);
  // Load the engine now on inner pages if a session should be restored; the landing page waits.
  const [wanted, setWanted] = useState(() => hasSavedSession() && location.pathname !== '/');
  const connectRequested = useRef(false);

  useEffect(() => {
    if (wanted || !hasSavedSession()) return;
    // Landing page with a saved session: restore it after first paint.
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = idle ? idle(() => setWanted(true), { timeout: 3000 }) : window.setTimeout(() => setWanted(true), 1500);
    return () => {
      const cancel = (window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (idle && cancel) cancel(id);
      else clearTimeout(id);
    };
  }, [wanted]);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);
  const takeConnectRequest = useCallback(() => {
    const r = connectRequested.current;
    connectRequested.current = false;
    return r;
  }, []);

  // Stand-in until the engine has loaded: pressing Connect loads it and connects.
  const standIn = useMemo<EngineValue>(() => {
    const load = async () => {
      connectRequested.current = true;
      setModalOpen(true);
      setWanted(true);
    };
    return {
      state: 'idle',
      walletName: null,
      error: null,
      uri: null,
      qrUri: null,
      connected: false,
      awake: false,
      connect: () => void load(),
      disconnect: async () => {},
      reconnect: load,
      addresses: [],
      receive0: null,
      fingerprint: null,
      scan: notConnected,
      signAndSend: notConnected,
    };
  }, []);

  const value = useMemo<WalletCtx>(() => ({ ...(engine ?? standIn), modalOpen, openModal, closeModal }), [engine, standIn, modalOpen, openModal, closeModal]);

  return (
    <Ctx.Provider value={value}>
      {wanted && (
        <Suspense fallback={null}>
          <Engine report={setEngine} takeConnectRequest={takeConnectRequest} openModal={openModal} />
        </Suspense>
      )}
      {children}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}
