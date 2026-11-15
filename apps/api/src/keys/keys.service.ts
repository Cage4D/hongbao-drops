// Gate keys (spec §8.3): one child key per envelope, derived from GATE_MASTER_SEED.
// Hardened derivation (m/i'), so leaking one envelope's key reveals nothing about the others or
// the seed. A gate key alone can't move funds: it only approves a specific share → recipient.
import { Inject, Injectable } from '@nestjs/common';
import { deriveHdPrivateNodeChild, deriveHdPrivateNodeFromSeed, hexToBin, secp256k1 } from '@bitauth/libauth';
import { CONFIG, type AppConfig } from '../config/config.js';

const HARDENED = 0x8000_0000;

@Injectable()
export class KeysService {
  private readonly root;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.root = deriveHdPrivateNodeFromSeed(hexToBin(config.GATE_MASTER_SEED));
  }

  gatePrivateKey(seq: number): Uint8Array {
    if (!Number.isInteger(seq) || seq < 0 || seq >= HARDENED) throw new Error('bad envelope seq');
    return deriveHdPrivateNodeChild(this.root, HARDENED + seq).privateKey;
  }

  gatePublicKey(seq: number): Uint8Array {
    return secp256k1.derivePublicKeyCompressed(this.gatePrivateKey(seq)) as Uint8Array;
  }
}
