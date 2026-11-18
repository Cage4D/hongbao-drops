// Live envelope updates over SSE (handoff §8). One stream per envelope page, closed on leave.
import { useEffect, useRef } from 'react';
import { api } from './api';

export interface ClaimedEvent {
  shareIndex: number;
  address: string;
  sats: number;
  usd: number | null;
  isNewWallet: boolean | null;
  luckiest: boolean;
  txid: string;
  /** NFT commitment of the seal, if any. */
  seal: string | null;
  sharesLeft: number;
  at: string;
}
export interface HeldEvent { shareIndex: number; heldUntil: string; at: string }
export interface ExhaustedEvent { claimed: number; at: string }
export interface RefundedEvent { txid: string; shares: number; sats: number; at: string }
export interface PassedOnEvent { childId: string; childSlug: string; shareCount: number; sats: number; at: string }

export interface EnvelopeHandlers {
  claimed?: (e: ClaimedEvent) => void;
  held?: (e: HeldEvent) => void;
  exhausted?: (e: ExhaustedEvent) => void;
  refunded?: (e: RefundedEvent) => void;
  passedOn?: (e: PassedOnEvent) => void;
}

export function useEnvelopeEvents(id: string | null, handlers: EnvelopeHandlers) {
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    if (!id || typeof EventSource === 'undefined') return;
    const es = new EventSource(api.eventsUrl(id));
    const on = (name: keyof EnvelopeHandlers) => (ev: MessageEvent) => {
      try {
        (h.current[name] as ((x: unknown) => void) | undefined)?.(JSON.parse(ev.data));
      } catch {
        /* malformed event */
      }
    };
    const names: (keyof EnvelopeHandlers)[] = ['claimed', 'held', 'exhausted', 'refunded', 'passedOn'];
    const ls = names.map((n) => [n, on(n)] as const);
    ls.forEach(([n, f]) => es.addEventListener(n, f as EventListener));
    return () => {
      ls.forEach(([n, f]) => es.removeEventListener(n, f as EventListener));
      es.close();
    };
  }, [id]);
}
