// Nav wallet button: "Connect wallet", or the connected address with a small menu (copy,
// explorer, My drops, Disconnect). Light on purpose: the connect modal (QR library) and the wallet
// engine load separately, on demand.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useWallet } from '../lib/wallet';
import { useNetwork } from '../lib/network';
import { shortAddr } from '../lib/format';

/** Small status button for the nav: connect, or (when connected) open the wallet menu. */
export function WalletButton({ small = true }: { small?: boolean }) {
  const w = useWallet();
  const cls = `btn btn-outline ${small ? 'btn-sm' : ''}`;
  if (w.connected) return <WalletMenu cls={cls} />;
  // Anything short of a working connection reads "Connect wallet". A saved session quietly
  // restoring in the background isn't something the user started, so don't show it as progress.
  return (
    <button className={cls} onClick={w.connect}>
      Connect wallet
    </button>
  );
}

/** Connected: the address button toggles a small menu with the address and Disconnect. */
function WalletMenu({ cls }: { cls: string }) {
  const w = useWallet();
  const { cfg } = useNetwork();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const addr = w.receive0?.address ?? '';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const disconnect = async () => {
    setLeaving(true);
    try {
      await w.disconnect();
    } finally {
      setLeaving(false);
      setOpen(false);
    }
  };

  return (
    <div className="wallet-menu" ref={root}>
      <button
        className={`${cls} wallet-on`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Your connected wallet"
      >
        <span className="dot" /> {addr ? shortAddr(addr) : 'Connected'}
        <span className={`wallet-caret ${open ? 'up' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="wallet-pop" role="menu" aria-label="Wallet">
          <p className="label" style={{ marginBottom: 4 }}>
            Connected{w.walletName ? ` · ${w.walletName}` : ''}
          </p>
          <p className="mono wallet-addr">{addr}</p>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-outline btn-sm"
              role="menuitem"
              onClick={() =>
                navigator.clipboard?.writeText(addr).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? 'Copied ✓' : 'Copy address'}
            </button>
            {cfg && addr && (
              <a className="btn btn-ghost btn-sm" role="menuitem" href={cfg.explorerAddr(addr)} target="_blank" rel="noreferrer">
                Explorer ↗
              </a>
            )}
          </div>
          <Link className="btn btn-primary btn-sm btn-block" role="menuitem" to="/activity" onClick={() => setOpen(false)} style={{ marginTop: 12 }}>
            My drops & activity
          </Link>
          <hr className="hr" style={{ margin: '14px 0' }} />
          <button className="btn btn-sm btn-block wallet-disconnect" role="menuitem" onClick={disconnect} disabled={leaving}>
            {leaving ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      )}
    </div>
  );
}
