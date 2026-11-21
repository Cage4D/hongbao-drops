// Connect over WizardConnect (any BCH wallet that supports it; Paytaca suggested). Lazy-loaded by
// Layout when the modal opens (it carries the QR library).
// Desktop: scan the QR with the wallet. Phone (same device): copy the wiz:// link and paste it in the
// wallet. A wiz:// deep link can't be relied on: Paytaca (the wallet we suggest) doesn't register
// the scheme, and its deep-link handler has no WizardConnect branch (checked Nov 2026,
// paytaca-app src/boot/deep-link.js), so tapping one does nothing. Its WizardConnect screen does have
// Paste URL → Connect, and the pairing finishes when the user comes back to this tab.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useWallet } from '../lib/wallet';
import { PAYTACA_URL } from '../lib/config';
import { shortAddr } from '../lib/format';
import { Modal } from './ui';

const isPhone = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = () => /android/i.test(navigator.userAgent);
/** Android: launch Paytaca (or its Play Store page when it isn't installed) without passing a URL. */
const PAYTACA_ANDROID_INTENT = 'intent://#Intent;package=com.paytaca.app;end';

export default function ConnectModal() {
  const w = useWallet();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyLink = () => {
    if (!w.uri) return;
    const done = () => setLinkCopied(true);
    if (navigator.clipboard) navigator.clipboard.writeText(w.uri).then(done, done);
    else done();
  };

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
        <div className="connect">
          <header className="connect-head">
            <p className="eyebrow">Step 1 · Connect with WizardConnect</p>
            <h2 className="disp disp-md">
              Link your <span className="flame">wallet</span>
            </h2>
          </header>

          {isPhone() ? (
            <>
              <ol className="phone-steps">
                <li className="phone-step-action">
                  <button className={`btn btn-lg btn-block ${linkCopied ? 'btn-ghost' : 'btn-primary'}`} onClick={copyLink} disabled={!w.uri}>
                    {!w.uri ? 'Preparing your link…' : linkCopied ? 'Link copied ✓' : 'Copy connection link'}
                  </button>
                </li>
                <li>
                  <span>
                    Open your wallet's <strong>WizardConnect</strong> screen. In Paytaca: <strong>Apps → WizardConnect → Paste URL</strong>.
                  </span>
                  {isAndroid() && (
                    <a className="btn btn-ghost btn-block phone-step-btn" href={PAYTACA_ANDROID_INTENT}>
                      Open Paytaca
                    </a>
                  )}
                </li>
                <li>
                  <span>
                    Paste the link and tap <strong>Connect</strong>.
                  </span>
                </li>
                <li>
                  <span>Come back to this page. It connects by itself.</span>
                </li>
              </ol>
              <div className="connect-extra small muted">
                {w.uri && (
                  <p>
                    Wallet app opens <span className="mono">wiz://</span> links? <a href={w.uri}>Open it directly</a>
                  </p>
                )}
                <details>
                  <summary>On another device? Show the QR code</summary>
                  {qr && (
                    <div className="qr-box connect-qr">
                      <img src={qr} alt="WizardConnect QR code" />
                    </div>
                  )}
                </details>
              </div>
            </>
          ) : (
            <div className="connect-desktop">
              <p>
                This connects over <strong>WizardConnect</strong>. Open your wallet's WizardConnect screen and scan this code. In
                Paytaca: <strong>Apps → WizardConnect → Scan QR Code</strong>.
              </p>
              <div className="qr-box">{qr ? <img src={qr} alt="WizardConnect QR code. Scan it from your wallet's WizardConnect screen." /> : <div className="qr-wait"><span className="spinner" /></div>}</div>
              <p className="small muted">
                Wallet on this computer? Use <strong>Copy link</strong> below, then <strong>Paste URL</strong> on the same WizardConnect
                screen.
              </p>
            </div>
          )}

          <footer className="connect-foot">
            <div className="connect-status small muted">
              <span className="row" style={{ gap: 8 }}>
                {w.state === 'connecting' || w.state === 'reconnecting' ? (
                  <>
                    <span className="spinner" style={{ width: 14, height: 14 }} /> Waiting for your wallet…
                  </>
                ) : (
                  <>Status: {w.state}</>
                )}
              </span>
              {w.uri && !isPhone() && (
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
            <div className="connect-links small">
              <a href={PAYTACA_URL} target="_blank" rel="noreferrer">
                No wallet yet? Try Paytaca →
              </a>
              <button className="btn-link small" onClick={w.reconnect}>
                Stuck? Start over
              </button>
            </div>
          </footer>
        </div>
      )}
    </Modal>
  );
}
