// Sponsored drops: create a sponsor (key shown once) → campaigns → sponsored envelopes → dashboard.
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { CampaignStats } from '@hongbao/shared';
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { api, errorText } from '../lib/api';
import { store } from '../lib/storage';
import { CampaignView } from '../components/CampaignView';
import { CopyField, Spinner, useToast } from '../components/ui';

interface SponsorSession {
  token: string;
  name: string;
  sponsorId?: string;
}
interface CampaignRef {
  id: string;
  name: string;
}
const SPONSOR = 'hongbao:sponsor';
/** Campaign list per sponsor key (a hash of it), so switching keys never shows another sponsor's campaigns. */
const campaignsKey = (token: string) => `hongbao:campaigns:${binToHex(sha256.hash(utf8ToBin(token))).slice(0, 16)}`;

export function Sponsor() {
  const [session, setSession] = useState<SponsorSession | null>(() => store.get(SPONSOR));
  const [fresh, setFresh] = useState<SponsorSession | null>(null);

  const save = (s: SponsorSession | null) => {
    if (s) store.set(SPONSOR, s);
    else store.drop(SPONSOR);
    setSession(s);
  };

  return (
    <div className="page">
      <div className="container">
        <p className="eyebrow">Sponsored drops</p>
        <h1 className="disp disp-lg">
          Put your brand <span className="flame">in the envelope</span>
        </h1>
        <p className="lead" style={{ maxWidth: 720 }}>
          Fund envelopes with your logo and a link. We count how many brand-new wallets you reached, and how many of them went on to
          use their BCH. Every number is checkable on-chain. Costs 3% on top of what you give away.
        </p>

        {fresh ? (
          <KeyOnce s={fresh} onDone={() => (save(fresh), setFresh(null))} />
        ) : session ? (
          <Dashboard session={session} onSignOut={() => save(null)} />
        ) : (
          <div className="grid-2" style={{ marginTop: 32, alignItems: 'start' }}>
            <CreateSponsor onCreated={setFresh} />
            <UseKey onUse={save} />
          </div>
        )}
      </div>
    </div>
  );
}

function CreateSponsor({ onCreated }: { onCreated: (s: SponsorSession) => void }) {
  const [f, setF] = useState({ name: '', logoUrl: '', brandColor: '#0066ff', ctaLabel: '', ctaUrl: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api.createSponsor({
        name: f.name.trim(),
        ...(f.logoUrl.trim() && { logoUrl: f.logoUrl.trim() }),
        ...(f.brandColor && { brandColor: f.brandColor }),
        ...(f.ctaLabel.trim() && { ctaLabel: f.ctaLabel.trim() }),
        ...(f.ctaUrl.trim() && { ctaUrl: f.ctaUrl.trim() }),
      });
      onCreated({ token: r.sponsorToken, name: f.name.trim(), sponsorId: r.sponsorId });
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2 className="disp disp-sm">New sponsor</h2>
      <div className="field" style={{ marginTop: 16 }}>
        <label className="label" htmlFor="sn">Brand name</label>
        <input id="sn" className="input" required maxLength={60} value={f.name} onChange={set('name')} />
      </div>
      <div className="field">
        <label className="label" htmlFor="sl">Logo URL <span className="hint">https, optional</span></label>
        <input id="sl" className="input" type="url" value={f.logoUrl} onChange={set('logoUrl')} placeholder="https://…/logo.png" />
      </div>
      <div className="field">
        <label className="label" htmlFor="sc">Brand colour</label>
        <div className="row">
          <input id="sc" type="color" className="color-input" value={f.brandColor} onChange={set('brandColor')} />
          <span className="mono">{f.brandColor}</span>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="cl">Button label</label>
          <input id="cl" className="input" maxLength={40} value={f.ctaLabel} onChange={set('ctaLabel')} placeholder="Visit our shop" />
        </div>
        <div className="field" style={{ marginTop: 0 }}>
          <label className="label" htmlFor="cu">Button link</label>
          <input id="cu" className="input" type="url" value={f.ctaUrl} onChange={set('ctaUrl')} placeholder="https://…" />
        </div>
      </div>
      {err && <div className="alert alert-error" style={{ marginTop: 16 }}>{err}</div>}
      <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={busy || !f.name.trim()}>
        {busy ? <Spinner size={16} /> : 'Create sponsor'}
      </button>
    </form>
  );
}

function UseKey({ onUse }: { onUse: (s: SponsorSession) => void }) {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        onUse({ token: token.trim(), name: name.trim() || 'Sponsor' });
      }}
    >
      <h2 className="disp disp-sm">Already a sponsor?</h2>
      <p className="small muted">Paste the sponsor key you saved when you signed up.</p>
      <div className="field">
        <label className="label" htmlFor="tk">Sponsor key</label>
        <input id="tk" className="input mono" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <div className="field">
        <label className="label" htmlFor="tn">Brand name <span className="hint">for this device</span></label>
        <input id="tn" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <button className="btn btn-outline btn-block" style={{ marginTop: 20 }} disabled={!token.trim()}>
        Use this key
      </button>
    </form>
  );
}

function KeyOnce({ s, onDone }: { s: SponsorSession; onDone: () => void }) {
  const [ack, setAck] = useState(false);
  return (
    <div className="card card-glow narrow-card" style={{ marginTop: 32 }}>
      <p className="eyebrow">Save this now</p>
      <h2 className="disp disp-md">Your sponsor key</h2>
      <p>
        This key is your login for the dashboard. <strong>We show it once</strong> and only keep a scrambled copy, so we can't send it to
        you again.
      </p>
      <CopyField value={s.token} label="Copy key" />
      <label className="switch" style={{ marginTop: 16 }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>I saved my sponsor key somewhere safe</span>
      </label>
      <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={!ack} onClick={onDone}>
        Continue
      </button>
    </div>
  );
}

function Dashboard({ session, onSignOut }: { session: SponsorSession; onSignOut: () => void }) {
  const toast = useToast();
  const CAMPAIGNS = campaignsKey(session.token);
  const [campaigns, setCampaigns] = useState<CampaignRef[]>(() => store.get(CAMPAIGNS) ?? []);
  const [active, setActive] = useState<string | null>(campaigns[0]?.id ?? null);
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [loading, setLoading] = useState(false);

  const saveList = (xs: CampaignRef[]) => {
    store.set(CAMPAIGNS, xs);
    setCampaigns(xs);
  };

  useEffect(() => {
    if (!active) return setStats(null);
    setLoading(true);
    setErr(null);
    api
      .campaignStats(session.token, active)
      .then(setStats)
      .catch((e) => {
        setStats(null);
        setErr(errorText(e));
      })
      .finally(() => setLoading(false));
  }, [active, session.token]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api.createCampaign(session.token, name.trim());
      saveList([{ id: r.campaignId, name: name.trim() }, ...campaigns]);
      setActive(r.campaignId);
      setName('');
      toast('Campaign created');
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const csv = async () => {
    if (!active) return;
    try {
      const blob = await api.campaignCsv(session.token, active);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hongbao-campaign-${active}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <div id="dashboard" className="sponsor-dash" style={{ marginTop: 32 }}>
      <aside className="card sponsor-side">
        <p className="label">Signed in as</p>
        <p style={{ color: '#fff', fontWeight: 700, margin: '4px 0 12px' }}>{session.name}</p>
        <button className="btn-link small" onClick={onSignOut}>
          Forget this key on this device
        </button>
        <hr className="hr" />
        <p className="label">Campaigns</p>
        <ul className="camp-list">
          {campaigns.map((c) => (
            <li key={c.id}>
              <button aria-pressed={active === c.id} onClick={() => setActive(c.id)}>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={create} className="stack" style={{ marginTop: 12 }}>
          <input className="input" placeholder="New campaign name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <button className="btn btn-primary btn-sm" disabled={!name.trim()}>
            Create campaign
          </button>
        </form>
        <form
          className="stack"
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            const id = openId.trim();
            if (!id) return;
            if (!campaigns.some((c) => c.id === id)) saveList([{ id, name: id }, ...campaigns]);
            setActive(id);
            setOpenId('');
          }}
        >
          <input className="input mono" placeholder="Open by campaign ID" value={openId} onChange={(e) => setOpenId(e.target.value)} />
        </form>
      </aside>

      <section>
        {err && <div className="alert alert-error">{err}</div>}
        {!active ? (
          <div className="card center">
            <p className="lead">Create your first campaign to start dropping branded envelopes.</p>
          </div>
        ) : loading && !stats ? (
          <Spinner size={32} />
        ) : stats ? (
          <>
            <div className="row" style={{ marginBottom: 16 }}>
              <Link className="btn btn-primary" to={`/send?campaign=${active}`}>
                New sponsored drop
              </Link>
              <button className="btn btn-outline" onClick={csv}>
                Download CSV
              </button>
              <Link className="btn btn-ghost" to={`/c/${active}`}>
                Public proof page
              </Link>
            </div>
            <CampaignView s={stats} />
          </>
        ) : null}
      </section>
    </div>
  );
}
