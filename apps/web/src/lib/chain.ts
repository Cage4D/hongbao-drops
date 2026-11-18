// The Fulcrum connection (cashscript). Kept out of network.tsx so the landing page doesn't load
// cashscript: only the claim, send and wallet code import this.
import { ElectrumNetworkProvider } from 'cashscript';
import type { Network } from '@hongbao/shared';
import type { NetCfg } from './network';

const providers = new Map<Network, ElectrumNetworkProvider>();
/** One Fulcrum connection per network, created lazily. */
export function chainProvider(cfg: NetCfg): ElectrumNetworkProvider {
  let p = providers.get(cfg.network);
  if (!p) {
    p = new ElectrumNetworkProvider(cfg.network === 'MAINNET' ? 'mainnet' : 'chipnet', { hostname: cfg.fulcrum[0]! });
    providers.set(cfg.network, p);
  }
  return p;
}
