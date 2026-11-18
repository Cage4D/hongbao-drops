// Connect over WizardConnect (any BCH wallet that supports it; Paytaca suggested).
// Desktop: scan the QR with the wallet. Phone: open the wallet directly.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useWallet } from '../lib/wallet';
import { PAYTACA_URL } from '../lib/config';
import { shortAddr } from '../lib/format';
import { Modal } from './ui';

const isPhone = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);

export function ConnectModal() {
  const w = useWallet();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!w.qrUri) return setQr(null);
    QRCode.toDataURL(w.qrUri, { errorCorrectionLevel: 'L', margin: 1, width: 480, color: { dark: '#07080c', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [w.qrUri]);

  // Close shortly after connecting, so the user sees the success state.
  useEffect(() => {
    if (w.modalOpen && w.connected) {
      const t = setTimeout(w.closeModal, 1400);
      return () => clearTimeout(t);
    }
  }, [w.modalOpen, w.connected, w.closeModal]);

  if (!w.modalOpen) return null;

  return (
    <Modal onClose={w.closeModal} label="Connect your wallet">
      {w.connected ? (
        <div className="center stack">
          <div className="connect-ok" aria-hidden="true">✓</div>
          <h2 className="disp disp-sm">Connected</h2>
          <p className="muted">
            {w.walletName ?? 'Your wallet'} · {w.receive0 ? shortAddr(w.receive0.address) : ''}
          </p>
        </div>
      ) : (
        <div className="stack">
          <p className="eyebrow">Step 1 · Connect</p>
          <h2 className="disp disp-md">
            Link your <span className="flame">wallet</span>
          </h2>
          {isPhone() && w.uri ? (
            <>
              <p>Open your Bitcoin Cash wallet on this phone and approve the connection.</p>
              <a className="btn btn-primary btn-lg btn-block" href={w.uri}>
                Open my wallet
              </a>
              <details className="small muted">
                <summary>On another device? Show the QR code</summary>
                {qr && (
                  <div className="qr-box" style={{ marginTop: 12 }}>
                    <img src={qr} alt="WizardConnect QR code" />
                  </div>
                )}
              </details>
            </>
          ) : (
            <>
              <p>In your Bitcoin Cash wallet, tap <strong>Scan</strong> and point it at this code.</p>
              <div className="qr-box">{qr ? <img src={qr} alt="Connection QR code. Scan it with your Bitcoin Cash wallet." /> : <div className="qr-wait"><span className="spinner" /></div>}</div>
            </>
          )}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="row small muted">
              {w.state === 'connecting' || w.state === 'reconnecting' ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14 }} /> Waiting for your wallet…
                </>
              ) : (
                <>Status: {w.state}</>
              )}
            </span>
            {w.uri && (
              <button
                className="btn-link small"
                onClick={() => {
                  navigator.clipboard?.writeText(w.uri!).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            )}
          </div>
          {w.error && <div className="alert alert-error">{w.error}</div>}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <a className="small" href={PAYTACA_URL} target="_blank" rel="noreferrer">
              No wallet yet? We suggest Paytaca (free) →
            </a>
            <button className="btn-link small" onClick={w.reconnect}>
              Stuck? Start over
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Small status button for the nav: connect, or show the real connection state. */
export function WalletButton({ small = true }: { small?: boolean }) {
  const w = useWallet();
  const cls = `btn btn-outline ${small ? 'btn-sm' : ''}`;
  if (w.connected)
    return (
      <button className={`${cls} wallet-on`} onClick={w.openModal} title="Connected wallet">
        <span className="dot" /> {w.receive0 ? shortAddr(w.receive0.address) : 'Connected'}
      </button>
    );
  // Anything short of a working connection reads "Connect wallet". A saved session quietly
  // restoring in the background isn't something the user started, so don't show it as progress.
  return (
    <button className={cls} onClick={w.connect}>
      Connect wallet
    </button>
  );
}
