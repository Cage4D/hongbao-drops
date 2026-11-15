// Local Chipnet keys for the Phase 2 scripts, persisted in scripts/.state (gitignored).
// These are TEST keys holding faucet coins only — never reuse them on mainnet.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  binToHex,
  decodePrivateKeyWif,
  encodeCashAddress,
  encodePrivateKeyWif,
  generatePrivateKey,
  hash160,
  hexToBin,
  secp256k1,
} from '@bitauth/libauth';
import { STATE_DIR } from './env.js';

export interface KeyPair {
  priv: Uint8Array;
  pub: Uint8Array;
  wif: string;
  lockingBytecode: Uint8Array;
  address: string; // bchtest:q…
  tokenAddress: string; // bchtest:z…
}

export function keyPairFromPriv(priv: Uint8Array): KeyPair {
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const pkh = hash160(pub);
  return {
    priv,
    pub,
    wif: encodePrivateKeyWif(priv, 'testnet'),
    lockingBytecode: Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]),
    address: encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: pkh }).address,
    tokenAddress: encodeCashAddress({ prefix: 'bchtest', type: 'p2pkhWithTokens', payload: pkh }).address,
  };
}

export const newKeyPair = () => keyPairFromPriv(generatePrivateKey());

export function keyPairFromWif(wif: string): KeyPair {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') throw new Error(decoded);
  return keyPairFromPriv(decoded.privateKey);
}

/** The faucet-funded sender wallet (also acts as treasury on Chipnet). Created on first use. */
export function walletKey(): KeyPair {
  const file = join(STATE_DIR, 'wallet.json');
  mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify({ privHex: binToHex(generatePrivateKey()) }, null, 2), { mode: 0o600 });
  }
  return keyPairFromPriv(hexToBin(JSON.parse(readFileSync(file, 'utf8')).privHex));
}

/** Chipnet treasury: receives identity + sponsor-fee outputs. Scripts never spend from it
 *  (spending the identity output would move the BCMR authhead). */
export function treasuryKey(): KeyPair {
  const file = join(STATE_DIR, 'treasury.json');
  mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify({ privHex: binToHex(generatePrivateKey()) }, null, 2), { mode: 0o600 });
  }
  return keyPairFromPriv(hexToBin(JSON.parse(readFileSync(file, 'utf8')).privHex));
}
