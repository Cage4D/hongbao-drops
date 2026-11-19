// Which network the API runs on (never hard-coded: read GET /health), plus the BCH price.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { HealthResponse, Network } from '@hongbao/shared';
import { api } from './api';

export interface NetCfg {
  network: Network;
  prefix: 'bitcoincash' | 'bchtest';
  wifNetwork: 'mainnet' | 'testnet';
  fulcrum: string[];
  explorerTx: (txid: string) => string;
  explorerAddr: (addr: string) => string;
  /** Mainnet caps (handoff §11); Chipnet is looser. */
  maxShares: number;
  maxSats: number;
  /** Mainnet only: the most an envelope may be worth in USD. */
  maxUsd: number | null;
  maxExpirySec: number;
}

export const NETS: Record<Network, NetCfg> = {
  CHIPNET: {
    network: 'CHIPNET',
    prefix: 'bchtest',
    wifNetwork: 'testnet',
    fulcrum: ['chipnet.imaginary.cash', 'chipnet.bch.ninja'],
    explorerTx: (t) => `https://chipnet.imaginary.cash/tx/${t}`,
    explorerAddr: (a) => `https://chipnet.imaginary.cash/address/${a}`,
    maxShares: 127,
    maxSats: 10_000_000,
    maxUsd: null,
    maxExpirySec: 30 * 86400,
  },
  MAINNET: {
    network: 'MAINNET',
    prefix: 'bitcoincash',
    wifNetwork: 'mainnet',
    fulcrum: ['bch.imaginary.cash', 'fulcrum.greyh.at'],
    explorerTx: (t) => `https://blockchair.com/bitcoin-cash/transaction/${t}`,
    explorerAddr: (a) => `https://blockchair.com/bitcoin-cash/address/${a}`,
    // Fallbacks only: the live limits come from GET /health (`limits`).
    maxShares: 10,
    maxSats: 200_000,
    maxUsd: 0.5,
    maxExpirySec: 24 * 3600,
  },
};

interface NetState {
  cfg: NetCfg | null;
  priceUsd: number | null;
  error: string | null;
}
const Ctx = createContext<NetState>({ cfg: null, priceUsd: null, error: null });

/** The server's own per-envelope limits win over the built-in fallbacks. */
export function withLimits(base: NetCfg, limits: HealthResponse['limits'] | undefined): NetCfg {
  if (!limits) return base;
  return { ...base, maxShares: limits.maxShares, maxSats: limits.maxEnvelopeSats, maxUsd: limits.maxEnvelopeUsd, maxExpirySec: limits.maxExpirySec };
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<NetState>({ cfg: null, priceUsd: null, error: null });
  useEffect(() => {
    let alive = true;
    const load = (attempt = 0) =>
      api
        .health()
        .then((h) => alive && setS({ cfg: withLimits(NETS[h.network] ?? NETS.MAINNET, h.limits), priceUsd: h.priceUsd, error: null }))
        .catch(() => {
          if (!alive) return;
          if (attempt < 3) setTimeout(() => load(attempt + 1), 2000 * (attempt + 1));
          else setS((p) => ({ ...p, error: "Can't reach Hongbao Drops right now." }));
        });
    load();
    return () => {
      alive = false;
    };
  }, []);
  return <Ctx.Provider value={s}>{children}</Ctx.Provider>;
}

export const useNetwork = () => useContext(Ctx);
