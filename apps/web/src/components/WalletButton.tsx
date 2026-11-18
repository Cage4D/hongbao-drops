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

/** "qruu…8gcs": the nav button on 360-px phones, where the logo needs the room. */
const tinyAddr = (a: string) => {
  const body = a.slice(a.indexOf(':') + 1);
  return `${body.slice(0, 4)}…${body.slice(-4)}`;
};

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
        title={w.awake ? 'Your connected wallet' : 'Your wallet (saved session: open the wallet app to sign)'}
      >
        <span className={`dot ${w.awake ? '' : 'dot-idle'}`} />{' '}
        {addr ? (
          <>
            <span className="addr-long">{shortAddr(addr)}</span>
            <span className="addr-tiny">{tinyAddr(addr)}</span>
          </>
        ) : (
          'Connected'
        )}
        <span className={`wallet-caret ${open ? 'up' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="wallet-pop" role="menu" aria-label="Wallet">
          <p className="label" style={{ marginBottom: 4 }}>
            {w.awake ? 'Connected' : 'Saved session'}
            {w.walletName ? ` · ${w.walletName}` : ''}
          </p>
          <p className="mono wallet-addr">{addr}</p>
          {!w.awake && (
            <div className="wallet-asleep">
              <p className="small muted">
                Your wallet app isn't answering right now. Claims work as usual; to send or sign, open the wallet app first. Disconnected Hongbao Drops in your wallet? Connect again.
              </p>
              <button
                className="btn btn-outline btn-sm"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void w.reconnect();
                }}
              >
                Connect again
              </button>
            </div>
          )}
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
