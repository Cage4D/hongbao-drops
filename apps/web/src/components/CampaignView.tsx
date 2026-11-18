// Sponsor funnel dashboard. Used privately (with the sponsor key) and on the public proof page.
import type { CampaignStats, PublicCampaignStats } from '@hongbao/shared';
import { useNetwork } from '../lib/network';
import { fmtSats, fmtUsd } from '../lib/format';
import { CountUp } from './ui';

export function CampaignView({ s, isPublic }: { s: CampaignStats | PublicCampaignStats; isPublic?: boolean }) {
  const { cfg } = useNetwork();
  const funnel = [
    { label: 'Shares opened', n: s.claims, hint: 'Every claim from this campaign’s envelopes' },
    { label: 'Fresh wallets', n: s.freshWallets, hint: 'Had no history before the claim' },
    { label: 'Activated', n: s.activatedWallets, hint: 'Used the BCH or passed it on within 7 days' },
    { label: 'Real new wallets', n: s.activatedNotFarm, hint: 'Activated and not suspected farming' },
  ];
  const max = Math.max(1, s.claims);
  return (
    <div className="campaign stack">
      <div className="campaign-head">
        {s.sponsor.logoUrl && <img src={s.sponsor.logoUrl} alt="" className="sponsor-logo lg" />}
        <div>
          <p className="eyebrow" style={{ color: s.sponsor.brandColor ?? undefined }}>
            {s.sponsor.name}
          </p>
          <h2 className="disp disp-md">{s.name}</h2>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Cost per real new wallet" value={s.costPerActivatedNewWalletUsd} fmt={(n) => fmtUsd(n)} big />
        <Kpi label="People reached" value={s.totalReach} fmt={(n) => Math.round(n).toLocaleString()} />
        <Kpi label="Spent" value={s.spentUsd ?? null} fmt={(n) => fmtUsd(n)} sub={`${fmtSats(s.spentSats)} sats`} />
        <Kpi label="CTA click rate" value={s.ctr != null ? s.ctr * 100 : null} fmt={(n) => `${n.toFixed(0)}%`} sub={`${s.ctaClicks} clicks`} />
      </div>

      <div className="card">
        <h3 className="disp disp-sm">The funnel</h3>
        <div className="funnel">
          {funnel.map((f, i) => (
            <div key={f.label} className="funnel-row">
              <div className="funnel-lbl">
                <strong>{f.label}</strong>
                <span className="small muted">{f.hint}</span>
              </div>
              <div className="funnel-bar">
                <span style={{ width: `${(f.n / max) * 100}%`, animationDelay: `${i * 120}ms` }} />
              </div>
              <span className="disp funnel-n">{f.n}</span>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          {s.pendingActivation} fresh {s.pendingActivation === 1 ? 'wallet is' : 'wallets are'} still inside their 7-day window · {s.suspectedFarms} flagged as possible farming (flags never block a claim).
        </p>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="disp disp-sm">Money</h3>
          <dl className="money">
            <dt>Given to people</dt>
            <dd>{fmtSats(s.givenAwaySats)} sats {s.givenAwayUsd != null && <span className="muted">{fmtUsd(s.givenAwayUsd)}</span>}</dd>
            <dt>Fees</dt>
            <dd>{fmtSats(s.feesSats)} sats {s.feesUsd != null && <span className="muted">{fmtUsd(s.feesUsd)}</span>}</dd>
            <dt>Still in lockboxes</dt>
            <dd>{fmtSats(s.lockedSats)} sats</dd>
            <dt>Returned to you</dt>
            <dd>{fmtSats(s.refundedSats)} sats</dd>
          </dl>
        </div>
        <div className="card">
          <h3 className="disp disp-sm">Check it yourself</h3>
          <p className="small muted">Every number here can be audited on-chain from these transactions.</p>
          <TxList label="Funding" ids={s.fundingTxids} explorer={cfg?.explorerTx} />
          <TxList label="Claims" ids={s.claimTxids} explorer={cfg?.explorerTx} />
          <TxList label="Returns" ids={s.refundTxids} explorer={cfg?.explorerTx} />
        </div>
      </div>

      {s.perEnvelope.length > 0 && (
        <div className="card table-wrap">
          <h3 className="disp disp-sm">Envelopes</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Envelope</th>
                <th>Status</th>
                <th>Opened</th>
                <th>Fresh</th>
                <th>Real new</th>
                <th>CTA</th>
              </tr>
            </thead>
            <tbody>
              {s.perEnvelope.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.slug}</td>
                  <td>{e.status.toLowerCase()}</td>
                  <td>
                    {e.claims}/{e.shareCount}
                  </td>
                  <td>{e.freshWallets}</td>
                  <td>{e.activatedNotFarm}</td>
                  <td>{e.ctaClicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">
        Updated {new Date(s.generatedAt).toLocaleString()}
        {isPublic ? ' · No addresses are shown on this page.' : ''}
      </p>
    </div>
  );
}

function Kpi({ label, value, fmt, sub, big }: { label: string; value: number | null; fmt: (n: number) => string; sub?: string; big?: boolean }) {
  return (
    <div className={`kpi card ${big ? 'kpi-big' : ''}`}>
      <span className="label">{label}</span>
      <span className="disp flame kpi-n">{value == null ? '—' : <CountUp value={value} format={fmt} />}</span>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}

function TxList({ label, ids, explorer }: { label: string; ids: string[]; explorer?: (t: string) => string }) {
  if (!ids.length) return null;
  return (
    <details className="txlist">
      <summary>
        {label} ({ids.length})
      </summary>
      <ul>
        {ids.map((t) => (
          <li key={t}>
            {explorer ? (
              <a className="mono" href={explorer(t)} target="_blank" rel="noreferrer">
                {t.slice(0, 16)}…
              </a>
            ) : (
              <span className="mono">{t}</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
