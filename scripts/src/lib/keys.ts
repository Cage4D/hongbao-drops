// Local keys, persisted in scripts/.state (gitignored). Chipnet keys are test keys holding faucet
// coins. Mainnet keys (--mainnet) live separately in scripts/.state/mainnet and are never created
// implicitly: only `wallet --mainnet --create` makes them.
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
import { MAINNET, PREFIX, STATE_DIR } from './env.js';

export interface KeyPair {
  priv: Uint8Array;
  pub: Uint8Array;
  wif: string;
  lockingBytecode: Uint8Array;
  address: string; // bchtest:q… / bitcoincash:q…
  tokenAddress: string; // bchtest:z… / bitcoincash:z…
}

export function keyPairFromPriv(priv: Uint8Array): KeyPair {
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const pkh = hash160(pub);
  return {
    priv,
    pub,
    wif: encodePrivateKeyWif(priv, MAINNET ? 'mainnet' : 'testnet'),
    lockingBytecode: Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]),
    address: encodeCashAddress({ prefix: PREFIX, type: 'p2pkh', payload: pkh }).address,
    tokenAddress: encodeCashAddress({ prefix: PREFIX, type: 'p2pkhWithTokens', payload: pkh }).address,
  };
}

export const newKeyPair = () => keyPairFromPriv(generatePrivateKey());

export function keyPairFromWif(wif: string): KeyPair {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') throw new Error(decoded);
  return keyPairFromPriv(decoded.privateKey);
}

/** Load a key file; create it only when allowed (always on Chipnet; on mainnet only on request). */
function stateKey(name: string, create: boolean): KeyPair {
  const file = join(STATE_DIR, name);
  if (!existsSync(file)) {
    if (MAINNET && !create) throw new Error(`No mainnet ${name} yet. Create it with: wallet --mainnet --create`);
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ privHex: binToHex(generatePrivateKey()) }, null, 2), { mode: 0o600, flag: 'wx' });
  }
  return keyPairFromPriv(hexToBin(JSON.parse(readFileSync(file, 'utf8')).privHex));
}

/** The sender wallet: faucet-funded on Chipnet; the dedicated demo wallet on mainnet (§10.1 rule 6). */
export function walletKey(create = false): KeyPair {
  return stateKey('wallet.json', create);
}

/** Treasury: receives identity + sponsor-fee outputs. Scripts never spend from it
 *  (spending the identity output would move the BCMR authhead). */
export function treasuryKey(create = false): KeyPair {
  return stateKey('treasury.json', create);
}
