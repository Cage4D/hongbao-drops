// /e/:id#k=…  and  /:slug#k=…   The claim page (Flow B) and the success screen.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { PublicEnvelopeView } from '@hongbao/shared';
import { api, ApiError, errorText } from '../lib/api';
import { useNetwork } from '../lib/network';
import { useWallet } from '../lib/wallet';
import { readLinkKey } from '../lib/link';
import { checkAddress, claimCoinState, claimShare, type ClaimResult } from '../lib/claim';
import { claimKey, envelopeHref, holdKey, type StoredClaim } from '../lib/local';
import { useEnvelopeEvents, type ClaimedEvent } from '../lib/events';
import { fmtBch, fmtSats, fmtUsd, satsToUsd, shortAddr, timeAgo } from '../lib/format';
import { store } from '../lib/storage';
import { PAYTACA_URL } from '../lib/config';
import { Envelope } from '../components/Envelope';
import { Burst } from '../components/Burst';
import { Countdown, Spinner, useToast } from '../components/ui';
import { DropTree } from '../components/DropTree';
import { NotFound } from './NotFound';

type Phase = 'sealed' | 'choose' | 'claiming' | 'done';
type Method = 'wallet' | 'paste' | 'hold';
interface StoredHold {
  holdToken: string;
  heldUntil: string;
}

export function EnvelopePage() {
  const { id: idParam, slug } = useParams();
  const { cfg, priceUsd } = useNetwork();
  const [view, setView] = useState<PublicEnvelopeView | null>(null);
  const [loadErr, setLoadErr] = useState<ApiError | Error | null>(null);
  const [linkKey] = useState(readLinkKey);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const v = idParam ? await api.envelope(idParam) : await api.bySlug(slug!);
      setView(v);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e as Error);
    }
  }, [idParam, slug]);
  useEffect(() => {
    load();
  }, [load]);

  // Live updates: merge the claim into the feed right away, then refresh the numbers.
  const [live, setLive] = useState<ClaimedEvent[]>([]);
  const [pulse, setPulse] = useState(0);
  const refetch = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const soon = useCallback(() => {
    clearTimeout(refetch.current);
    refetch.current = setTimeout(load, 600);
  }, [load]);
  useEnvelopeEvents(view?.id ?? null, {
    claimed: (e) => {
      setLive((xs) => (xs.some((x) => x.txid === e.txid) ? xs : [e, ...xs].slice(0, 20)));
      setView((v) => (v ? { ...v, shares: { ...v.shares, left: e.sharesLeft, claimed: v.shares.total - e.sharesLeft } } : v));
      setPulse((p) => p + 1);
      soon();
    },
    exhausted: soon,
    refunded: soon,
    passedOn: (e) => {
      toast(`Someone passed it on: a new envelope for ${e.shareCount} 🧧`);
      soon();
    },
  });

  if (loadErr) {
    if (loadErr instanceof ApiError && loadErr.code === 'NOT_FOUND') return <NotFound what="envelope" />;
    return (
      <div className="page narrow center stack">
        <h1 className="disp disp-md">Hmm.</h1>
        <p>{errorText(loadErr)}</p>
        <button className="btn btn-primary" onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (!view || !cfg)
    return (
      <div className="page center" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="stack center">
          <div className="env-skeleton" />
          <p className="muted">Finding your envelope…</p>
        </div>
      </div>
    );

  return <EnvelopeView view={view} linkKey={linkKey} live={live} pulse={pulse} reload={load} priceUsd={priceUsd} />;
}

function EnvelopeView({
  view,
  linkKey,
  live,
  pulse,
  reload,
  priceUsd,
}: {
  view: PublicEnvelopeView;
  linkKey: Uint8Array | null | 'bad';
  live: ClaimedEvent[];
  pulse: number;
  reload: () => void;
  priceUsd: number | null;
}) {
  const { cfg } = useNetwork();
  const [claimed, setClaimed] = useState<StoredClaim | null>(() => store.get<StoredClaim>(claimKey(view.id)));
  const [phase, setPhase] = useState<Phase>(claimed ? 'done' : 'sealed');
  const [fire, setFire] = useState(0);
  const [expiredNow, setExpiredNow] = useState(false);
  const expiresAt = useMemo(() => Date.now() + view.secondsLeft * 1000, [view.secondsLeft]);

  const status = expiredNow && view.status === 'ACTIVE' ? 'EXPIRED' : view.status;
  const claimable = status === 'ACTIVE' && view.shares.left > 0 && linkKey instanceof Uint8Array;
  const sponsor = view.sponsor;

  const open = () => {
    setPhase('choose');
    setFire((f) => f + 1);
  };
  const onClaimed = (r: ClaimResult) => {
    store.set(claimKey(view.id), r);
    store.drop(holdKey(view.id));
    setClaimed(r);
    setPhase('done');
    setFire((f) => f + 1);
    reload();
  };

  // Merge live claims ahead of the snapshot's recent claims.
  const feed = useMemo(() => {
    const fromLive = live.map((e) => ({ address: e.address, sats: e.sats, usd: e.usd, luckiest: e.luckiest, isNewWallet: e.isNewWallet, at: e.at, live: true }));
    const seen = new Set(fromLive.map((x) => `${x.address}:${x.sats}`));
    return [...fromLive, ...view.recentClaims.filter((c) => !seen.has(`${c.address}:${c.sats}`)).map((c) => ({ ...c, live: false }))].slice(0, 12);
  }, [live, view.recentClaims]);

  const brand = sponsor?.brandColor ?? null;

  return (
    <div className="page envelope-page" style={brand ? ({ '--brand': brand } as CSSProperties) : undefined}>
      <Burst fire={fire} originY={0.35} />
      <div className="env-bg" aria-hidden="true" />
      <div className="container">
        {sponsor && <SponsorBar view={view} />}
        <div className="env-grid">
          {/* -------------------------------------------------------- envelope */}
          <section className="env-stage" aria-label="The envelope">
            <Envelope
              theme={view.theme}
              size={250}
              open={phase !== 'sealed'}
              onOpen={phase === 'sealed' && claimable ? open : undefined}
              sealText={view.mode === 'QUIZ' ? '?' : 'OPEN'}
              shake={phase === 'sealed' && claimable}
              slip={
                phase === 'done' && claimed ? (
                  <>
                    <span className="slip-amt">{fmtSats(claimed.amountSats)}</span>
                    <span className="slip-unit">sats</span>
                  </>
                ) : (
                  <span className="slip-fu" lang="zh">福</span>
                )
              }
              label={<span className={`tag tag-black ${pulse ? 'tag-bump' : ''}`} key={pulse}>{view.shares.left} of {view.shares.total} left</span>}
            />
            {phase === 'sealed' && claimable && (
              <button className="btn btn-primary btn-lg tap-open" onClick={open}>
                Open it
              </button>
            )}
            <div className="env-numbers">
              <div>
                <span className="disp flame env-big">{view.remaining.usd != null ? fmtUsd(view.remaining.usd) : fmtSats(view.remaining.sats)}</span>
                <span className="small muted">{view.remaining.usd != null ? `${fmtSats(view.remaining.sats)} sats left inside` : 'sats left inside'}</span>
              </div>
              {status === 'ACTIVE' && (
                <div>
                  <span className="env-cd">
                    <Countdown until={expiresAt} onDone={() => setExpiredNow(true)} />
                  </span>
                  <span className="small muted">until it closes</span>
                </div>
              )}
            </div>
            <ShareDots total={view.shares.total} left={view.shares.left} />
          </section>

          {/* -------------------------------------------------------- panel */}
          <section className="env-panel" aria-live="polite">
            <p className="eyebrow">
              {view.mode === 'LUCKY' ? 'Lucky draw' : view.mode === 'QUIZ' ? 'Quiz envelope' : 'Equal split'}
              {sponsor ? ` · from ${sponsor.name}` : ''}
            </p>
            <h1 className="disp disp-lg env-title">
              {phase === 'done' ? (
                <>
                  Money <span className="flame">arrived</span>
                </>
              ) : (
                <>
                  A red envelope <span className="flame">for you</span>
                </>
              )}
            </h1>
            {view.message && phase !== 'done' && <blockquote className="env-message">“{view.message}”</blockquote>}

            {phase === 'done' && claimed ? (
              <Success r={claimed} view={view} priceUsd={priceUsd} />
            ) : !(linkKey instanceof Uint8Array) && status === 'ACTIVE' ? (
              <div className="alert alert-warn">
                <strong>This link is incomplete.</strong> The part after the # is missing or cut off, and that's the part that opens the envelope.
                Ask the sender to send the full link again.
              </div>
            ) : status !== 'ACTIVE' || view.shares.left === 0 ? (
              <Closed status={view.shares.left === 0 && status === 'ACTIVE' ? 'EXHAUSTED' : status} />
            ) : phase === 'sealed' ? (
              <p className="lead">
                {view.shares.left} {view.shares.left === 1 ? 'share is' : 'shares are'} still inside. Tap the envelope to open yours. It's free: you don't need any BCH and you sign nothing.
              </p>
            ) : (
              <ClaimPanel view={view} linkKey={linkKey as Uint8Array} onClaimed={onClaimed} busy={phase === 'claiming'} setBusy={(b) => setPhase(b ? 'claiming' : 'choose')} />
            )}
          </section>
        </div>

        {/* ---------------------------------------------------------- feed + stamp */}
        <div className="env-lower">
          <section className="card feed" aria-labelledby="feed-title">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 id="feed-title" className="disp disp-sm">
                Who opened it
              </h2>
              {status === 'ACTIVE' && (
                <span className="tag">
                  <span className="dot" /> Live
                </span>
              )}
            </div>
            {feed.length === 0 ? (
              <p className="muted" style={{ marginTop: 12 }}>
                Nobody yet. Be the first!
              </p>
            ) : (
              <ul className="feed-list">
                {feed.map((c, i) => (
                  <li key={`${c.address}-${c.at}-${i}`} className={c.live ? 'feed-new' : ''}>
                    <span className="feed-who">
                      <span className="mono">{shortAddr(c.address)}</span>
                      {c.luckiest && <span className="tag tag-bright">Luckiest</span>}
                      {c.isNewWallet && <span className="tag tag-dark">New wallet</span>}
                    </span>
                    <span className="feed-amt">
                      <strong>{fmtSats(c.sats)}</strong> sats {c.usd != null && <span className="muted small">{fmtUsd(c.usd)}</span>}
                      <span className="small muted feed-time">{timeAgo(c.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {view.stamp && (
            <section className="card stamp-card" aria-labelledby="stamp-title">
              <h2 id="stamp-title" className="disp disp-sm">
                The stamp
              </h2>
              <img src={view.stamp.imageUrl} alt={view.stamp.alt} className="stamp-img" loading="lazy" />
              <p className="small muted">Everyone who opens a share gets one of these in their wallet, numbered.</p>
            </section>
          )}
        </div>

        <DropTree envelopeId={view.id} />

        <div className="center" style={{ margin: '48px 0 16px' }}>
          {cfg && view.fundingTxid && (
            <a className="small" href={cfg.explorerTx(view.fundingTxid)} target="_blank" rel="noreferrer">
              See the lockbox on the explorer ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ShareDots({ total, left }: { total: number; left: number }) {
  if (total > 30) return null;
  return (
    <div className="share-dots" aria-label={`${left} of ${total} shares left`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < total - left ? 'gone' : ''} />
      ))}
    </div>
  );
}

function SponsorBar({ view }: { view: PublicEnvelopeView }) {
  const s = view.sponsor!;
  return (
    <div className="sponsor-bar">
      {s.logoUrl && <img src={s.logoUrl} alt="" className="sponsor-logo" />}
      <span>
        Sponsored by <strong>{s.name}</strong>
      </span>
      {s.ctaUrl && s.ctaLabel && (
        <a className="btn btn-sm btn-ghost" href={s.ctaUrl} target="_blank" rel="noreferrer noopener" onClick={() => api.ctaClick(view.id).catch(() => {})}>
          {s.ctaLabel}
        </a>
      )}
    </div>
  );
}

function Closed({ status }: { status: string }) {
  const copy: Record<string, [string, string]> = {
    EXHAUSTED: ['Too slow!', 'All the shares have been grabbed.'],
    EXPIRED: ['This one has closed', 'Leftovers return to the sender automatically about an hour after it expires.'],
    REFUNDED: ['This one has closed', 'The leftovers already went back to the sender.'],
    PENDING_FUNDING: ['Not sealed yet', "The sender hasn't finished sending this envelope. Try again in a minute."],
    FAILED: ['This envelope broke', "Its money never arrived in the lockbox, so there's nothing to open."],
  };
  const [t, b] = copy[status] ?? ['Not open', 'This envelope can’t be opened right now.'];
  return (
    <div className="stack">
      <div className="alert">
        <strong>{t}</strong> {b}
      </div>
      <p>Why not start your own?</p>
      <Link className="btn btn-primary btn-lg" to="/send">
        Send your own
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------ claiming
function ClaimPanel({
  view,
  linkKey,
  onClaimed,
  busy,
  setBusy,
}: {
  view: PublicEnvelopeView;
  linkKey: Uint8Array;
  onClaimed: (r: ClaimResult) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const { cfg } = useNetwork();
  const wallet = useWallet();
  const [method, setMethod] = useState<Method>(() => (store.get<StoredHold>(holdKey(view.id)) ? 'hold' : 'wallet'));
  const [answer, setAnswer] = useState('');
  const [addr, setAddr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [hold, setHold] = useState<StoredHold | null>(() => {
    const h = store.get<StoredHold>(holdKey(view.id));
    return h && new Date(h.heldUntil).getTime() > Date.now() ? h : null;
  });
  const quiz = view.mode === 'QUIZ';

  const go = async (recipientAddress: string, extra: { walletFingerprint?: string; holdToken?: string } = {}) => {
    if (!cfg) return;
    if (quiz && !answer.trim()) return setError('Answer the question first.');
    setError(null);
    setBusy(true);
    try {
      const r = await claimShare(cfg, view.id, linkKey, { recipientAddress, ...extra, ...(quiz && { answer: answer.trim() }) });
      onClaimed(r);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        if (e.code === 'WRONG_ANSWER') setAttemptsLeft(typeof e.extra.attemptsLeft === 'number' ? e.extra.attemptsLeft : null);
        if (e.code === 'HOLD_EXPIRED') {
          store.drop(holdKey(view.id));
          setHold(null);
        }
      }
      setError(errorText(e));
    }
  };

  const claimWithWallet = () => {
    if (!wallet.receive0) return wallet.connect();
    go(wallet.receive0.tokenAddress, wallet.fingerprint ? { walletFingerprint: wallet.fingerprint } : {});
  };
  const claimWithAddress = () => {
    if (!cfg) return;
    const c = checkAddress(addr, cfg);
    if (!c.ok) return setError(c.error);
    go(c.address, hold ? { holdToken: hold.holdToken } : {});
  };
  const holdShare = async () => {
    setError(null);
    setBusy(true);
    try {
      const h = await api.hold(view.id);
      store.set(holdKey(view.id), h);
      setHold(h);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (busy)
    return (
      <div className="claiming">
        <Spinner size={36} />
        <p className="lead" style={{ margin: 0 }}>
          Opening your share…
        </p>
        <p className="small muted">Unwrapping the lockbox and sending your share. A few seconds.</p>
      </div>
    );

  return (
    <div className="claim-panel stack">
      {quiz && (
        <div className="field quiz-q">
          <label className="label" htmlFor="ans">
            The sender asks
          </label>
          <p className="quiz-question">{view.quizQuestion}</p>
          <input id="ans" className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" maxLength={200} autoComplete="off" />
          {attemptsLeft !== null && <span className="field-error">{attemptsLeft} {attemptsLeft === 1 ? 'try' : 'tries'} left</span>}
        </div>
      )}

      <div className="seg" role="tablist" aria-label="How do you want to receive it?">
        <button role="tab" aria-pressed={method === 'wallet'} aria-selected={method === 'wallet'} onClick={() => setMethod('wallet')}>
          Wallet
          <small>connect</small>
        </button>
        <button role="tab" aria-pressed={method === 'paste'} aria-selected={method === 'paste'} onClick={() => setMethod('paste')}>
          Address
          <small>paste</small>
        </button>
        <button role="tab" aria-pressed={method === 'hold'} aria-selected={method === 'hold'} onClick={() => setMethod('hold')}>
          No wallet
          <small>hold it</small>
        </button>
      </div>

      {method === 'wallet' && (
        <div className="stack">
          {wallet.connected && wallet.receive0 ? (
            <>
              <p className="small muted">
                Sending to your wallet <span className="mono">{shortAddr(wallet.receive0.tokenAddress)}</span>
              </p>
              <button className="btn btn-primary btn-lg btn-block" onClick={claimWithWallet}>
                Claim my share
              </button>
            </>
          ) : (
            <>
              <p className="small muted">Connect your Bitcoin Cash wallet and your share lands in it. You won't be asked to pay or sign anything.</p>
              <button className="btn btn-primary btn-lg btn-block" onClick={wallet.connect}>
                Connect wallet
              </button>
            </>
          )}
        </div>
      )}

      {method === 'paste' && (
        <div className="stack">
          <div className="field">
            <label className="label" htmlFor="addr">
              Your Bitcoin Cash address
            </label>
            <input
              id="addr"
              className="input mono"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder={`${cfg?.prefix ?? 'bitcoincash'}:q…`}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <span className="help">In your wallet: Receive → copy. Any Bitcoin Cash address works.</span>
          </div>
          <button className="btn btn-primary btn-lg btn-block" onClick={claimWithAddress} disabled={!addr.trim()}>
            Claim my share
          </button>
        </div>
      )}

      {method === 'hold' && (
        <div className="stack">
          {hold ? (
            <>
              <div className="hold-box">
                <span className="small muted">Your share is held for</span>
                <span className="disp flame hold-cd">
                  <Countdown
                    until={new Date(hold.heldUntil).getTime()}
                    compact
                    onDone={() => {
                      store.drop(holdKey(view.id));
                      setHold(null);
                    }}
                  />
                </span>
              </div>
              <ol className="hold-steps">
                <li>
                  <a href={PAYTACA_URL} target="_blank" rel="noreferrer">
                    Try Paytaca
                  </a>{' '}
                  (free, about a minute), or use any Bitcoin Cash wallet.
                </li>
                <li>Come back to this same link.</li>
                <li>Connect your wallet or paste its address below.</li>
              </ol>
              <a className="btn btn-ghost btn-block" href={PAYTACA_URL} target="_blank" rel="noreferrer">
                Try Paytaca
              </a>
              <div className="field">
                <label className="label" htmlFor="addr2">
                  Got it? Paste your address
                </label>
                <input id="addr2" className="input mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={`${cfg?.prefix ?? 'bitcoincash'}:q…`} autoComplete="off" spellCheck={false} />
              </div>
              <div className="row">
                <button className="btn btn-primary" onClick={claimWithAddress} disabled={!addr.trim()}>
                  Claim my held share
                </button>
                {wallet.connected && wallet.receive0 && (
                  <button
                    className="btn btn-outline"
                    onClick={() => go(wallet.receive0!.tokenAddress, { holdToken: hold.holdToken, ...(wallet.fingerprint && { walletFingerprint: wallet.fingerprint }) })}
                  >
                    Send to my wallet
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="small muted">
                No wallet yet? Try Paytaca. We'll hold a share for you for <strong>15 minutes</strong> while you set it up.
              </p>
              <button className="btn btn-primary btn-lg btn-block" onClick={holdShare}>
                Hold my share
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ success
function Success({ r, view, priceUsd }: { r: StoredClaim; view: PublicEnvelopeView; priceUsd: number | null }) {
  const { cfg } = useNetwork();
  const navigate = useNavigate();
  const usd = r.amountUsd ?? satsToUsd(r.amountSats, priceUsd);
  const passOn = () => {
    const suggest = Math.floor(r.amountSats / 2);
    navigate(`/send?parent=${view.id}&coin=${r.txid}&suggest=${suggest}`);
  };
  // A share can be passed on once: the pass-on spends the claimed coin. Check it's still there.
  const [coin, setCoin] = useState<'checking' | 'unspent' | 'spent' | 'unknown'>(r.passedOn ? 'spent' : 'checking');
  useEffect(() => {
    if (!cfg || r.passedOn) return;
    let alive = true;
    claimCoinState(cfg, r.recipientAddress, r.txid).then((s) => alive && setCoin(s));
    return () => {
      alive = false;
    };
  }, [cfg, r.passedOn, r.recipientAddress, r.txid]);
  return (
    <div className="success stack">
      <div className="success-amount">
        <span className="disp flame success-big">{fmtSats(r.amountSats)}</span>
        <span className="success-unit">
          sats
          <span className="muted small">
            {' '}
            · {fmtBch(r.amountSats)} BCH{usd != null && ` · ${fmtUsd(usd)}`}
          </span>
        </span>
      </div>
      <p>
        Sent to <span className="mono">{shortAddr(r.recipientAddress)}</span>. It's already yours: the network has it, and it shows in your wallet within seconds.
        {cfg?.network === 'CHIPNET' && ' (On the test network some wallets may not show it; the explorer will.)'}
      </p>
      {r.isNewWallet && (
        <div className="alert alert-ok">
          <strong>Welcome to Bitcoin Cash!</strong> This was your wallet's first coin.
        </div>
      )}
      {r.stamp && (
        <figure className="success-stamp">
          <img src={r.stamp.imageUrl} alt={r.stamp.alt} />
          <figcaption className="small muted">Your collectible stamp. It's in your wallet too.</figcaption>
        </figure>
      )}
      {r.passedOn ? (
        <div className="alert alert-ok">
          <strong>You passed it on.</strong> This share went into a new envelope.{' '}
          <Link to={r.passedOn.url ? r.passedOn.url.replace(location.origin, '') : envelopeHref(r.passedOn.id, r.passedOn.slug)}>Watch your pass-on →</Link>
        </div>
      ) : (
        coin === 'spent' && (
          <div className="alert">
            <strong>Already moved.</strong> These coins have been passed on or spent, so this share can't be passed on again.{' '}
            <Link to="/activity">See your activity →</Link>
          </div>
        )
      )}
      <div className="row">
        {!r.passedOn && coin !== 'spent' && (
          <button className="btn btn-primary btn-lg" onClick={passOn} disabled={coin === 'checking'}>
            Pass it on
          </button>
        )}
        <Link className={`btn btn-lg ${r.passedOn || coin === 'spent' ? 'btn-primary' : 'btn-ghost'}`} to="/send">
          Send your own
        </Link>
      </div>
      {cfg && (
        <a className="small" href={cfg.explorerTx(r.txid)} target="_blank" rel="noreferrer">
          See it on the explorer ↗
        </a>
      )}
    </div>
  );
}
