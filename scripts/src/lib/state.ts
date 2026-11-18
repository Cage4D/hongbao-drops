// Envelope state for the Phase 2 scripts (stand-in for the Phase 3 database).
// Holds the link secret and gate key — test keys only, file is gitignored.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from './env.js';

export interface ShareState {
  index: number; // 1-based
  txid: string;
  vout: number;
  sats: string;
  commitment?: string;
  status: 'AVAILABLE' | 'CLAIMED' | 'REFUNDED';
  spendTxid?: string;
}

export interface EnvelopeState {
  name: string;
  seq: number;
  createdAt: string;
  linkPrivHex: string;
  gatePrivHex: string;
  refundLockingBytecodeHex: string;
  expiry: number;
  maxFee: string;
  withSeals: boolean;
  sealCategory?: string;
  prepTxid?: string;
  fundingTxid: string;
  contractAddress: string;
  bcmrRegistry?: string;
  shares: ShareState[];
}

const dir = () => {
  const d = join(STATE_DIR, 'envelopes');
  mkdirSync(d, { recursive: true });
  return d;
};

export function saveEnvelope(e: EnvelopeState) {
  writeFileSync(join(dir(), `${e.name}.json`), JSON.stringify(e, null, 2), { mode: 0o600 });
}

export function loadEnvelope(name: string): EnvelopeState {
  const f = join(dir(), `${name}.json`);
  if (!existsSync(f)) throw new Error(`No envelope "${name}" in ${dir()}`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

/** Monotonic local sequence number (gate key index / seal commitment prefix). */
export function nextSeq(): number {
  const f = join(STATE_DIR, 'seq.json');
  const seq = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).seq + 1 : 1;
  writeFileSync(f, JSON.stringify({ seq }));
  return seq;
}
