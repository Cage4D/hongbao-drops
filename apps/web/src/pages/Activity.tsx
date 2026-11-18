// /activity: the connected wallet's drops, opened shares and pass-ons (POST /wallets/activity).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { WalletActivityResponse, WalletClaim, WalletSentEnvelope } from '@hongbao/shared';
import { api, errorText } from '../lib/api';
import { useWallet } from '../lib/wallet';
import { useNetwork } from '../lib/network';
import { fmtSats, fmtUsd, satsToUsd, shortAddr, timeAgo } from '../lib/format';
import { envelopeHref, sentDrops } from '../lib/local';
import { Envelope } from '../components/Envelope';
import { CountUp, Spinner, useToast } from '../components/ui';

type Tab = 'sent' | 'opened';

const STATUS: Record<string, { label: string; cls: string; live?: boolean }> = {
  ACTIVE: { label: 'Live', cls: '', live: true },
  EXHAUSTED: { label: 'All opened', cls: 'tag-bright' },
  EXPIRED: { label: 'Closed', cls: 'tag-dark' },
  REFUNDED: { label: 'Leftovers returned', cls: 'tag-dark' },
};

export function Activity() {
  const wallet = useWallet();
  const { priceUsd } = useNetwork();
  const [data, setData] = useState<WalletActivityResponse | null>(null);
  const [unspent, setUnspent] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('sent');

  const load = useCallback(async () => {
    if (!wallet.connected) return;
    setLoading(true);
    setErr(null);
    try {
      const [activity, coins] = await Promise.all([
        api.walletActivity(wallet.addresses.map((a) => a.lockingHex)),
        // Which claimed coins are still in the wallet (only those can be passed on).
        wallet.scan().catch(() => []),
      ]);
      setData(activity);
      setUnspent(new Set(coins.map((u) => `${u.txid}:${u.vout}`)));
      if (!activity.sent.length && activity.claimed.length) setTab('opened');
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [wallet.connected, wallet.addresses, wallet.scan]);

  useEffect(() => {
    load();
  }, [load]);

  if (!wallet.connected)
    return (
      <div className="page narrow center stack">
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <Envelope theme="lunar" size={130} sealText="?" />
        </div>
        <p className="eyebrow">Your activity</p>
        <h1 className="disp disp-lg">
          Connect to see <span className="flame">your drops</span>
        </h1>
        <p className="lead">Everything you've sent, opened and passed on, from your Bitcoin Cash wallet.</p>
        <div>
          <button className="btn btn-primary btn-lg" onClick={wallet.connect}>
            Connect wallet
          </button>
        </div>
      </div>
    );

  const t = data?.totals;
  return (
    <div className="page activity-page">
      <div className="container">
        <div className="activity-head">
          <div>
            <p className="eyebrow">Your activity</p>
            <h1 className="disp disp-lg">
              Your <span className="flame">drops</span>
            </h1>
            <p className="muted mono" style={{ marginTop: 8 }}>
              {wallet.receive0 ? wallet.receive0.address : ''}
            </p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
            {loading ? <Spinner size={14} /> : 'Refresh'}
          </button>
        </div>

        <div className="activity-stats">
          <Stat label="Drops sent" value={t?.sentCount ?? null} />
          <Stat label="Sats sent" value={t?.sentSats ?? null} sub={t ? fmtUsd(satsToUsd(t.sentSats, priceUsd)) : ''} />
          <Stat label="Shares opened" value={t?.claimedCount ?? null} />
          <Stat label="Sats received" value={t?.claimedSats ?? null} sub={t ? fmtUsd(satsToUsd(t.claimedSats, priceUsd)) : ''} />
          <Stat label="Passed on" value={t?.passOnCount ?? null} />
        </div>

        {err && (
          <div className="alert alert-error" style={{ marginTop: 24 }}>
            {err}
          </div>
        )}

        <div className="seg activity-tabs" role="tablist" aria-label="Activity">
          <button role="tab" aria-pressed={tab === 'sent'} aria-selected={tab === 'sent'} onClick={() => setTab('sent')}>
            Drops you sent
            <small>{data ? data.sent.length : '…'}</small>
          </button>
          <button role="tab" aria-pressed={tab === 'opened'} aria-selected={tab === 'opened'} onClick={() => setTab('opened')}>
            Shares you opened
            <small>{data ? data.claimed.length : '…'}</small>
          </button>
        </div>

        {!data ? (
          <div className="center" style={{ padding: 48 }}>
            <Spinner size={32} />
          </div>
        ) : tab === 'sent' ? (
          <SentList items={data.sent} />
        ) : (
          <OpenedList items={data.claimed} unspent={unspent} />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div className="card activity-stat">
      <span className="label">{label}</span>
      <span className="disp flame activity-stat-n">
        <CountUp value={value} format={(n) => Math.round(n).toLocaleString('en-US')} />
      </span>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}

function Empty({ text, cta }: { text: string; cta: { to: string; label: string } }) {
  return (
    <div className="card center activity-empty">
      <p className="lead" style={{ margin: 0 }}>
        {text}
      </p>
      <Link className="btn btn-primary" to={cta.to}>
        {cta.label}
      </Link>
    </div>
  );
}

function SentList({ items }: { items: WalletSentEnvelope[] }) {
  const toast = useToast();
  const local = useMemo(() => new Map(sentDrops().map((d) => [d.id, d.url])), []);
  if (!items.length) return <Empty text="You haven't sent a drop from this wallet yet." cta={{ to: '/send', label: 'Send a drop' }} />;
  return (
    <ul className="activity-list">
      {items.map((e, i) => {
        const st = STATUS[e.status] ?? { label: e.status.toLowerCase(), cls: 'tag-dark' };
        const url = local.get(e.id);
        const pct = e.shares.total ? (e.shares.claimed / e.shares.total) * 100 : 0;
        return (
          <li key={e.id} className="activity-item" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
            <span className="activity-env" aria-hidden="true">
              <Envelope theme={e.theme} size={46} sealText="" inline />
            </span>
            <div className="activity-main">
              <div className="row" style={{ gap: 8 }}>
                <span className={`tag ${st.cls}`}>
                  {st.live && <span className="dot" />}
                  {st.label}
                </span>
                {e.parentEnvelopeId && <span className="tag tag-dark">Passed on</span>}
                <span className="small muted">{timeAgo(e.createdAt)}</span>
              </div>
              <p className="activity-msg">{e.message || <span className="muted">Red envelope</span>}</p>
              <div className="activity-bar" aria-label={`${e.shares.claimed} of ${e.shares.total} opened`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <span className="small muted">
                {e.shares.claimed} of {e.shares.total} opened · {e.mode.toLowerCase()}
                {e.refundedSats > 0 ? ` · ${fmtSats(e.refundedSats)} sats returned to you` : ''}
              </span>
            </div>
            <div className="activity-side">
              <span className="disp activity-amt">{fmtSats(e.total.sats)}</span>
              <span className="small muted">sats{e.total.usd != null ? ` · ${fmtUsd(e.total.usd)}` : ''}</span>
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {url && e.status === 'ACTIVE' && (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Link copied 🧧'))}
                  >
                    Copy link
                  </button>
                )}
                <Link className="btn btn-ghost btn-sm" to={envelopeHref(e.id, e.slug)}>
                  View
                </Link>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OpenedList({ items, unspent }: { items: WalletClaim[]; unspent: Set<string> }) {
  const navigate = useNavigate();
  const { cfg } = useNetwork();
  if (!items.length) return <Empty text="No shares opened with this wallet yet." cta={{ to: '/', label: 'Find a drop' }} />;
  return (
    <ul className="activity-list">
      {items.map((c, i) => {
        const canPass = !c.passedOn && c.claimTxid !== null && unspent.has(`${c.claimTxid}:0`);
        return (
          <li key={`${c.envelopeId}-${c.at}`} className="activity-item" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
            {c.stamp ? (
              <img className="activity-stamp" src={c.stamp.imageUrl} alt="Your collectible stamp from this envelope" loading="lazy" />
            ) : (
              <span className="activity-env" aria-hidden="true">
                <Envelope theme={c.theme} size={46} sealText="" inline />
              </span>
            )}
            <div className="activity-main">
              <div className="row" style={{ gap: 8 }}>
                {c.passedOn ? <span className="tag">Passed on</span> : canPass ? <span className="tag tag-bright">Can pass on</span> : <span className="tag tag-dark">Coins moved</span>}
                {c.isNewWallet && <span className="tag tag-dark">First coin</span>}
                <span className="small muted">{timeAgo(c.at)}</span>
              </div>
              <p className="activity-msg">{c.message || <span className="muted">Red envelope</span>}</p>
              <span className="small muted">
                To <span className="mono">{shortAddr(c.recipientAddress)}</span>
                {c.claimTxid && cfg && (
                  <>
                    {' · '}
                    <a href={cfg.explorerTx(c.claimTxid)} target="_blank" rel="noreferrer">
                      explorer ↗
                    </a>
                  </>
                )}
              </span>
            </div>
            <div className="activity-side">
              <span className="disp activity-amt flame">+{fmtSats(c.amountSats)}</span>
              <span className="small muted">sats{c.amountUsd != null ? ` · ${fmtUsd(c.amountUsd)}` : ''}</span>
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {c.passedOn ? (
                  <Link className="btn btn-ghost btn-sm" to={envelopeHref(c.passedOn.id, c.passedOn.slug)}>
                    Your pass-on
                  </Link>
                ) : (
                  canPass && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => navigate(`/send?parent=${c.envelopeId}&coin=${c.claimTxid}&suggest=${Math.floor(c.amountSats / 2)}`)}
                    >
                      Pass it on
                    </button>
                  )
                )}
                <Link className="btn btn-outline btn-sm" to={`/${c.slug}`}>
                  Envelope
                </Link>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
