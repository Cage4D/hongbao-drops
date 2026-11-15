// Script environment. All scripts in this folder are CHIPNET-ONLY (spec §10.1 rule 1):
// they refuse to run if NETWORK is set to anything else.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

if ((process.env.NETWORK ?? 'CHIPNET') !== 'CHIPNET') {
  throw new Error(`scripts/ only run on CHIPNET (NETWORK=${process.env.NETWORK}). Refusing.`);
}

/** Fulcrum hostnames from FULCRUM_URLS (wss://host:port,...), with Phase 0's working defaults. */
export const FULCRUM_HOSTS = (process.env.FULCRUM_URLS ?? 'wss://chipnet.imaginary.cash:50004,wss://chipnet.bch.ninja:50004')
  .split(',')
  .map((u) => new URL(u.trim()).hostname);

export const PUBLIC_API_URL = process.env.PUBLIC_API_URL ?? 'http://localhost:3000';
export const EXPLORER_TX = 'https://chipnet.imaginary.cash/tx/';
export const STATE_DIR = fileURLToPath(new URL('../../.state/', import.meta.url));
