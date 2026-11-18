// BCH BLAZE 2026 banner: presentation, source code, and where to send EMBER2026 votes.
// Home page only, at the very top (inside the fixed header, above the nav). Not dismissible.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { BLAZE } from '../config/blaze';

/** "zqxcan…hv8amd", for the narrow layout only (copy and QR always use the full address). */
const shortAddress = (a: string) => {
  const body = a.slice(a.indexOf(':') + 1);
  return `${body.slice(0, 6)}…${body.slice(-6)}`;
};

export function BlazeBanner() {
  const root = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const panelId = useId();

  // Publish the banner's height so the page below can leave room for it (it sits in the fixed header).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--blaze-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--blaze-h');
    };
  }, []);

  useEffect(() => {
    if (!qrOpen || qr) return;
    QRCode.toDataURL(BLAZE.voteAddress, { margin: 1, width: 360, color: { dark: '#07080c', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [qrOpen, qr]);

  useEffect(() => {
    if (!qrOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setQrOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qrOpen]);

  const copy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(BLAZE.voteAddress).then(done, done);
    else done();
  };

  return (
    <div className="blaze" ref={root} role="region" aria-label="BCH BLAZE 2026">
      <div className="blaze-inner">
        <span className="blaze-row blaze-links">
          {BLAZE.presentationUrl ? (
            <a href={BLAZE.presentationUrl} target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">📄 </span>Presentation
            </a>
          ) : (
            <span className="blaze-soon">
              <span aria-hidden="true">📄 </span>Presentation <span className="blaze-muted">(link soon)</span>
            </span>
          )}
          <span className="blaze-sep" aria-hidden="true">·</span>
          <a href={BLAZE.sourceUrl} target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true">💻 </span>Source code
          </a>
        </span>
        <span className="blaze-sep blaze-sep-mid" aria-hidden="true">·</span>
        <span className="blaze-row blaze-vote">
          <span>
            <span aria-hidden="true">🗳️ </span>
            <span className="blaze-vote-long">Vote for us: send {BLAZE.voteToken} tokens to</span>
            <span className="blaze-vote-short">
              Vote: {BLAZE.voteToken} to
            </span>
          </span>
          <code className="blaze-addr" title={BLAZE.voteAddress}>
            <span className="blaze-addr-full">{BLAZE.voteAddress}</span>
            <span className="blaze-addr-short">
              {shortAddress(BLAZE.voteAddress)}
            </span>
          </code>
          <button type="button" className="blaze-btn" onClick={copy} aria-label={copied ? 'Voting address copied' : 'Copy the voting address'}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            type="button"
            className="blaze-btn"
            onClick={() => setQrOpen((o) => !o)}
            aria-expanded={qrOpen}
            aria-controls={panelId}
            aria-label={qrOpen ? 'Hide the QR code' : 'Show QR code of the voting address'}
          >
            <span className="blaze-qr-long">{qrOpen ? 'Hide QR' : 'Show QR'}</span>
            <span className="blaze-qr-short">QR</span>
          </button>
          <span className="sr-only" aria-live="polite">
            {copied ? 'Copied!' : ''}
          </span>
        </span>
      </div>
      {qrOpen && (
        <div className="blaze-qr" id={panelId} role="dialog" aria-label="QR code of the voting address">
          <div className="qr-box">{qr ? <img src={qr} alt={`QR code of ${BLAZE.voteAddress}`} /> : <div className="qr-wait" />}</div>
          <p className="blaze-qr-text">
            Send <strong>{BLAZE.voteToken}</strong> tokens to
          </p>
          <code className="blaze-qr-addr">{BLAZE.voteAddress}</code>
          <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={copy} aria-label={copied ? 'Voting address copied' : 'Copy the voting address'}>
              {copied ? 'Copied!' : 'Copy address'}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setQrOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
