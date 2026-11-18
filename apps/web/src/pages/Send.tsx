// Create an envelope (Flow A), or pass one on (Flow C: ?parent=<envelopeId>&coin=<claim txid>&got=<sats claimed>).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import QRCode from 'qrcode';
import type { Mode, Theme } from '@hongbao/shared';
import { useNetwork } from '../lib/network';
import { useWallet } from '../lib/wallet';
import { InsufficientFunds } from '../lib/txplan';
import { FundingUnconfirmed, confirmFunding, createAndFund, passOnDefaults, type FundResult, type FundStep } from '../lib/fund';
import { errorText } from '../lib/api';
import { fmtBch, fmtDuration, fmtSats, fmtUsd, satsToUsd, usdToSats } from '../lib/format';
import { store } from '../lib/storage';
import { SENT_KEY, markPassedOn, type SentDrop } from '../lib/local';
import { Envelope, THEMES } from '../components/Envelope';
import { Burst } from '../components/Burst';
import { CopyField, StepsLog, useToast } from '../components/ui';
import { WalletButton } from '../components/WalletButton';

const MIN_SHARE_SEAL = 2000;
const MIN_SHARE_PLAIN = 1500;


const EXPIRY_CHOICES = [
  { sec: 3600, label: '1 hour' },
  { sec: 6 * 3600, label: '6 hours' },
  { sec: 24 * 3600, label: '24 hours' },
  { sec: 7 * 86400, label: '7 days' },
];

export function Send() {
  const { cfg, priceUsd } = useNetwork();
  const wallet = useWallet();
  const toast = useToast();
  const [params] = useSearchParams();
  const parent = params.get('parent');
  const coin = params.get('coin');
  // What the claimer received (older links carried half of it as `suggest`).
  const got = Number(params.get('got') || 0) || 2 * Number(params.get('suggest') || 0);
  const passOn = parent ? passOnDefaults(got) : null;
  const campaignId = params.get('campaign');
  const sponsor = campaignId ? store.get<{ token: string; name: string }>('hongbao:sponsor') : null;

  const [mode, setMode] = useState<Mode>(passOn?.shareCount === 1 ? 'EQUAL' : 'LUCKY');
  const [shareCount, setShareCount] = useState(passOn?.shareCount ?? 5);
  const [unit, setUnit] = useState<'usd' | 'sats'>('usd');
  const [sats, setSats] = useState<number>(passOn?.sats ?? 20_000);
  const [amountText, setAmountText] = useState('');
  const [message, setMessage] = useState(parent ? 'Passing the luck on!' : 'Happy Lunar New Year!');
  const [theme, setTheme] = useState<Theme>('lunar');
  const [expirySec, setExpirySec] = useState(24 * 3600);
  const [withSeals, setWithSeals] = useState(true);
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<string[]>(['']);

  const [step, setStep] = useState<FundStep | null>(null);
  const [stepNote, setStepNote] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FundResult | null>(null);
  /** Funded on-chain but not confirmed by the API yet: retry only the check, never fund again. */
  const [pending, setPending] = useState<FundResult | null>(null);
  const abort = useRef<AbortController | null>(null);

  const minShare = withSeals ? MIN_SHARE_SEAL : MIN_SHARE_PLAIN;
  const maxShares = cfg?.maxShares ?? 10;
  const maxSatsByUsd = cfg?.network === 'MAINNET' && priceUsd ? usdToSats(0.5, priceUsd) : Infinity;
  const maxSats = Math.min(cfg?.maxSats ?? 200_000, maxSatsByUsd);
  const expiryChoices = EXPIRY_CHOICES.filter((c) => c.sec <= (cfg?.maxExpirySec ?? 86400));

  // Keep the text box in sync when the unit flips or a preset is picked.
  useEffect(() => {
    if (unit === 'usd' && priceUsd) setAmountText((satsToUsd(sats, priceUsd) ?? 0).toFixed(2));
    else setAmountText(String(sats));
  }, [unit, priceUsd]);
  useEffect(() => {
    if (!priceUsd) setUnit('sats');
  }, [priceUsd]);

  const onAmount = (txt: string) => {
    setAmountText(txt);
    const n = Number(txt.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n)) return;
    setSats(unit === 'usd' && priceUsd ? usdToSats(n, priceUsd) : Math.round(n));
  };
  const setPreset = (s: number) => {
    setSats(s);
    setAmountText(unit === 'usd' && priceUsd ? (satsToUsd(s, priceUsd) ?? 0).toFixed(2) : String(s));
  };

  const problems = useMemo(() => {
    const p: string[] = [];
    if (sats < minShare * shareCount) p.push(`${shareCount} shares need at least ${fmtSats(minShare * shareCount)} sats (${fmtSats(minShare)} each).`);
    if (sats > maxSats) p.push(cfg?.network === 'MAINNET' ? `During the demo an envelope can hold up to $0.50 (${fmtSats(maxSats)} sats).` : `Max ${fmtSats(maxSats)} sats.`);
    if (mode === 'QUIZ') {
      if (!question.trim()) p.push('Write the quiz question.');
      if (!answers.some((a) => a.trim())) p.push('Add at least one accepted answer.');
    }
    if (message.length > 280) p.push('Keep the message under 280 characters.');
    return p;
  }, [sats, minShare, shareCount, maxSats, mode, question, answers, message, cfg]);

  const presets = useMemo(() => {
    if (!priceUsd) return [10_000, 20_000, 50_000];
    return [0.1, 0.25, 0.5].map((u) => Math.min(usdToSats(u, priceUsd), maxSats));
  }, [priceUsd, maxSats]);

  const busy = step !== null && !error && !result;

  // Don't let the sender lose the only copy of the link.
  const [linkSaved, setLinkSaved] = useState(false);
  useEffect(() => {
    if (!result || linkSaved) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [result, linkSaved]);

  // Save the link the moment the money is in the lockbox, so it survives any later failure.
  const remember = (r: FundResult) => {
    const sent = store.get<SentDrop[]>(SENT_KEY) ?? [];
    if (sent.some((d) => d.id === r.created.id)) return;
    store.set(SENT_KEY, [
      { id: r.created.id, slug: r.created.slug, url: r.url, totalSats: sats, shareCount, theme, message: message.trim(), createdAt: new Date().toISOString(), ...(parent && { parent }) },
      ...sent,
    ].slice(0, 30));
    // The claimed share is now spent: the claim page shows this pass-on instead of the button.
    if (parent) markPassedOn(parent, { id: r.created.id, slug: r.created.slug, url: r.url });
  };

  const fail = (e: unknown) => {
    if (e instanceof FundingUnconfirmed) {
      setPending(e.pending);
      setError(`Your envelope is sent and the money is in the lockbox, but we couldn't confirm it yet (${errorText(e.cause)}). Your link is saved under “Your recent drops”. Tap Check again in a moment.`);
    } else setError(e instanceof InsufficientFunds ? insufficientText(e, priceUsd) : errorText(e));
  };

  const submit = async () => {
    if (!cfg || problems.length) return;
    setError(null);
    if (pending) {
      setStep('confirm');
      try {
        setResult(await confirmFunding(pending));
        setPending(null);
      } catch (e) {
        fail(e);
      }
      return;
    }
    abort.current = new AbortController();
    try {
      const r = await createAndFund({
        wallet,
        cfg,
        draft: {
          shareCount,
          mode,
          totalSats: sats,
          // At the network's maximum (24 h on mainnet) keep 5 min of slack: a phone clock running a
          // little ahead of the server's would otherwise ask for more than the API allows.
          expiry: Math.floor(Date.now() / 1000) + Math.min(expirySec, cfg.maxExpirySec - 300),
          message: message.trim() || undefined,
          theme,
          withSeals,
          ...(mode === 'QUIZ' && { quiz: { question: question.trim(), answers: answers.map((a) => a.trim()).filter(Boolean) } }),
          ...(parent && { parentEnvelopeId: parent }),
          ...(sponsor && campaignId && { sponsorToken: sponsor.token, campaignId }),
        },
        mustSpend: coin ? { txid: coin, vout: 0 } : undefined,
        onStep: (s, note) => {
          setStep(s);
          setStepNote(note);
        },
        onBroadcast: remember,
        signal: abort.current.signal,
      });
      setResult(r);
    } catch (e) {
      fail(e);
    }
  };

  if (result) return <Created result={result} theme={theme} shareCount={shareCount} sats={sats} message={message} onSaved={() => setLinkSaved(true)} toast={toast} passOn={!!parent} />;

  const perShare = Math.floor(sats / Math.max(1, shareCount));
  const usd = satsToUsd(sats, priceUsd);

  return (
    <div className="page send-page">
      <div className="container">
        <p className="eyebrow">{parent ? 'Pass it on' : sponsor ? `Sponsored drop · ${sponsor.name}` : 'Send a drop'}</p>
        <h1 className="disp disp-lg">
          {parent ? (
            <>
              Gift it <span className="flame">forward</span>
            </>
          ) : (
            <>
              Fill your <span className="flame">envelope</span>
            </>
          )}
        </h1>
        {parent && <p className="lead">Re-gift part of what you opened as a new envelope. It joins the same drop tree.</p>}

        <div className="send-grid">
          {/* -------------------------------------------------------- form */}
          <form
            className="card send-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <fieldset disabled={busy || !!pending} className="bare">
              <div className="field">
                <span className="label">
                  Amount
                  {priceUsd && (
                    <span className="unit-toggle">
                      <button type="button" aria-pressed={unit === 'usd'} onClick={() => setUnit('usd')}>
                        USD
                      </button>
                      <button type="button" aria-pressed={unit === 'sats'} onClick={() => setUnit('sats')}>
                        sats
                      </button>
                    </span>
                  )}
                </span>
                <div className="amount-wrap">
                  {unit === 'usd' && <span className="amount-prefix">$</span>}
                  <input
                    className="input input-xl"
                    inputMode="decimal"
                    value={amountText}
                    onChange={(e) => onAmount(e.target.value)}
                    aria-label={unit === 'usd' ? 'Amount in US dollars' : 'Amount in sats'}
                    aria-invalid={problems.some((p) => p.includes('sats'))}
                  />
                  {unit === 'sats' && <span className="amount-suffix">sats</span>}
                </div>
                <span className="help">
                  = {fmtSats(sats)} sats · {fmtBch(sats)} BCH{usd != null && unit === 'sats' ? ` · ${fmtUsd(usd)}` : ''}
                </span>
                <div className="chips">
                  {presets.map((p) => (
                    <button key={p} type="button" className="chip" aria-pressed={sats === p} onClick={() => setPreset(p)}>
                      {priceUsd ? fmtUsd(satsToUsd(p, priceUsd)) : `${fmtSats(p)} sats`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="label">
                  How many people <span className="hint">up to {maxShares}</span>
                </span>
                <div className="stepper">
                  <button type="button" onClick={() => setShareCount((n) => Math.max(1, n - 1))} aria-label="Fewer">
                    −
                  </button>
                  <span className="disp stepper-n" aria-live="polite">
                    {shareCount}
                  </span>
                  <button type="button" onClick={() => setShareCount((n) => Math.min(maxShares, n + 1))} aria-label="More">
                    +
                  </button>
                  <span className="help">≈ {mode === 'LUCKY' ? 'avg ' : ''}{fmtSats(perShare)} sats each{priceUsd ? ` (${fmtUsd(satsToUsd(perShare, priceUsd))})` : ''}</span>
                </div>
              </div>

              <div className="field">
                <span className="label">Mode</span>
                <div className="seg">
                  {(
                    [
                      ['EQUAL', 'Equal', 'same for all'],
                      ['LUCKY', 'Lucky', 'random'],
                      ['QUIZ', 'Quiz', 'answer to open'],
                    ] as const
                  ).map(([m, l, s]) => (
                    <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                      {l}
                      <small>{s}</small>
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'QUIZ' && (
                <div className="quiz-box">
                  <div className="field">
                    <label className="label" htmlFor="q">
                      Question
                    </label>
                    <input id="q" className="input" maxLength={200} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What coin is this envelope full of?" />
                  </div>
                  <div className="field">
                    <span className="label">
                      Accepted answers <span className="hint">not case-sensitive</span>
                    </span>
                    {answers.map((a, i) => (
                      <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                        <input
                          className="input"
                          maxLength={100}
                          value={a}
                          onChange={(e) => setAnswers((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                          placeholder={i === 0 ? 'Bitcoin Cash' : 'BCH'}
                          aria-label={`Answer ${i + 1}`}
                        />
                        {answers.length > 1 && (
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setAnswers((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove answer">
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {answers.length < 3 && (
                      <button type="button" className="btn-link small" style={{ alignSelf: 'flex-start' }} onClick={() => setAnswers((xs) => [...xs, ''])}>
                        + another accepted answer
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="field">
                <label className="label" htmlFor="msg">
                  Message <span className="hint">{message.length}/280</span>
                </label>
                <textarea id="msg" className="textarea" maxLength={280} value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>

              <div className="field">
                <span className="label">Theme</span>
                <div className="themes">
                  {(['lunar', 'classic-red', 'gold', 'christmas'] as const).map((t) => (
                    <button key={t} type="button" className="theme-opt" aria-pressed={theme === t} onClick={() => setTheme(t)}>
                      <span className="theme-env" aria-hidden="true">
                        <Envelope theme={t} size={58} sealText="" inline />
                      </span>
                      {THEMES[t].label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="label">Open for</span>
                <div className="chips">
                  {expiryChoices.map((c) => (
                    <button key={c.sec} type="button" className="chip" aria-pressed={expirySec === c.sec} onClick={() => setExpirySec(c.sec)}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <span className="help">Leftovers return to you automatically about an hour after it closes.</span>
              </div>

              <div className="field">
                <label className="switch">
                  <input type="checkbox" checked={withSeals} onChange={(e) => setWithSeals(e.target.checked)} />
                  <span>
                    <strong style={{ color: '#fff' }}>Hongbao Seals</strong>
                    <span className="help" style={{ display: 'block' }}>
                      Each opener also gets a seal in their wallet. Min {fmtSats(MIN_SHARE_SEAL)} sats per share.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          </form>

          {/* -------------------------------------------------------- preview + action */}
          <aside className="send-side">
            <div className="card card-glow preview-card">
              <div className="preview-env">
                <Envelope theme={theme} size={180} sealText={mode === 'QUIZ' ? '?' : 'OPEN'} label={<span className="tag tag-black">{shareCount} left</span>} />
              </div>
              <p className="preview-msg">{message || <span className="muted">No message</span>}</p>
              <div className="preview-meta">
                <span className="disp flame" style={{ fontSize: 40, lineHeight: 1 }}>
                  {usd != null ? fmtUsd(usd) : `${fmtSats(sats)}`}
                </span>
                <span className="small muted">
                  {fmtSats(sats)} sats · {shareCount} {shareCount === 1 ? 'share' : 'shares'} · {mode.toLowerCase()} · {fmtDuration(expirySec)}
                </span>
              </div>

              {problems.length > 0 && (
                <ul className="problems">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}

              {step && (
                <div style={{ marginTop: 16 }}>
                  <StepsLog
                    current={step}
                    failed={!!error}
                    steps={[
                      { key: 'scan', label: 'Checking your wallet' },
                      ...(step === 'prep' ? [{ key: 'prep', label: 'Preparing a coin', note: stepNote }] : []),
                      { key: 'create', label: 'Setting up the lockbox' },
                      { key: 'sign', label: 'Approve in your wallet', note: stepNote ?? 'Check your phone.' },
                      { key: 'confirm', label: 'Sealing the envelope', note: 'Waiting for the network to see it (a few seconds).' },
                    ]}
                  />
                </div>
              )}
              {error && (
                <div className="alert alert-error" style={{ marginTop: 12 }} role="alert">
                  {error}
                </div>
              )}

              <div style={{ marginTop: 20 }}>
                {!wallet.connected ? (
                  <div className="stack">
                    <WalletButton small={false} />
                    <p className="help center">Connect a Bitcoin Cash wallet to fund the envelope. You'll approve one payment.</p>
                  </div>
                ) : busy ? (
                  <button className="btn btn-outline btn-block" type="button" onClick={() => abort.current?.abort()}>
                    Cancel
                  </button>
                ) : (
                  <button className="btn btn-primary btn-lg btn-block" disabled={!!problems.length || !cfg} onClick={submit}>
                    {pending ? 'Check again' : error ? 'Try again' : parent ? 'Pass it on' : `Fund & seal · ${usd != null ? fmtUsd(usd) : `${fmtSats(sats)} sats`}`}
                  </button>
                )}
              </div>
              {sponsor && <p className="help center" style={{ marginTop: 10 }}>Sponsored drops add a 3% fee (min 546 sats).</p>}
            </div>
            <RecentDrops />
          </aside>
        </div>
      </div>
    </div>
  );
}

function insufficientText(e: InsufficientFunds, price: number | null): string {
  const short = Number(e.needSats - e.haveSats);
  const usd = satsToUsd(short, price);
  return `Your wallet needs about ${fmtSats(short)} more sats${usd != null ? ` (${fmtUsd(usd)})` : ''} for this envelope and its network fee. Top up your wallet or lower the amount.`;
}

function Created({
  result,
  theme,
  shareCount,
  sats,
  message,
  onSaved,
  toast,
  passOn,
}: {
  result: FundResult;
  theme: Theme;
  shareCount: number;
  sats: number;
  message: string;
  onSaved: () => void;
  toast: (m: string) => void;
  passOn: boolean;
}) {
  const { cfg, priceUsd } = useNetwork();
  const [qr, setQr] = useState<string | null>(null);
  const [fire, setFire] = useState(0);
  useEffect(() => {
    setFire(1);
    QRCode.toDataURL(result.url, { margin: 1, width: 480, color: { dark: '#07080c', light: '#ffffff' } }).then(setQr).catch(() => {});
  }, [result.url]);
  const canShare = typeof navigator.share === 'function';
  const usd = satsToUsd(sats, priceUsd);
  const path = result.url.replace(location.origin, '');
  return (
    <div className="page created-page">
      <Burst fire={fire} originY={0.3} />
      <div className="narrow center stack">
        <div className="created-env">
          <Envelope theme={theme} size={170} label={<span className="tag tag-black">{shareCount} left</span>} />
        </div>
        <p className="eyebrow">{passOn ? 'Passed on' : 'Sealed and live'}</p>
        <h1 className="disp disp-lg">
          Your drop is <span className="flame">live</span>
        </h1>
        <p className="lead">
          {usd != null ? fmtUsd(usd) : `${fmtSats(sats)} sats`} for {shareCount} {shareCount === 1 ? 'person' : 'people'}. Now drop the link in your chat.
        </p>

        <div className="card card-glow" style={{ textAlign: 'left' }}>
          <p className="label" style={{ marginBottom: 8 }}>
            Your envelope link
          </p>
          <CopyField
            value={result.url}
            label="Copy link"
            onCopied={() => {
              onSaved();
              toast('Link copied. Paste it in your group chat 🧧');
            }}
          />
          <div className="row" style={{ marginTop: 12 }}>
            {canShare && (
              <button
                className="btn btn-primary"
                onClick={() =>
                  navigator
                    .share({ title: '🧧 A red envelope for you', text: message || 'Open it before it runs out!', url: result.url })
                    .then(onSaved)
                    .catch(() => {})
                }
              >
                Share…
              </button>
            )}
            <a className="btn btn-ghost" href={`https://t.me/share/url?url=${encodeURIComponent(result.url)}&text=${encodeURIComponent('🧧 ' + (message || 'A red envelope for you'))}`} target="_blank" rel="noreferrer" onClick={onSaved}>
              Telegram
            </a>
            <a className="btn btn-ghost" href={`https://wa.me/?text=${encodeURIComponent(`🧧 ${message ? message + ' ' : ''}${result.url}`)}`} target="_blank" rel="noreferrer" onClick={onSaved}>
              WhatsApp
            </a>
          </div>
          <div className="alert alert-warn" style={{ marginTop: 16 }}>
            <strong>This link is the key.</strong> Anyone with it can open a share, and we can't recover it if it's lost. We kept a copy on
            this device under “Your recent drops”.
          </div>
          {qr && (
            <details style={{ marginTop: 16 }}>
              <summary className="small">Show a QR code (for dropping in person)</summary>
              <div className="qr-box" style={{ marginTop: 12 }}>
                <img src={qr} alt="QR code of the envelope link" />
              </div>
            </details>
          )}
        </div>

        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-outline" to={path} onClick={onSaved}>
            Watch it live
          </Link>
          {cfg && (
            <a className="btn-link small" href={cfg.explorerTx(result.txid)} target="_blank" rel="noreferrer">
              See the lockbox on the explorer
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function RecentDrops() {
  const [list] = useState(() => store.get<SentDrop[]>(SENT_KEY) ?? []);
  if (!list.length) return null;
  return (
    <div className="card recent-drops">
      <p className="label" style={{ marginBottom: 8 }}>
        Your recent drops
      </p>
      <ul>
        {list.slice(0, 5).map((d) => (
          <li key={d.id}>
            <Link to={d.url.replace(location.origin, '')}>
              <span>{d.message || 'Red envelope'}</span>
              <span className="small muted">
                {fmtSats(d.totalSats)} sats · {d.shareCount} shares · {new Date(d.createdAt).toLocaleDateString()}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
