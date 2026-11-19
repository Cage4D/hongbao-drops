import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { GlobalStats, Network } from '@hongbao/shared';
import { api } from '../lib/api';
import { DEMO_URL } from '../lib/config';
import { fmtBch } from '../lib/format';
import { useReveal } from '../lib/hooks';
import { Dragon } from '../components/Dragon';
import { Envelope } from '../components/Envelope';
import { CountUp } from '../components/ui';
import { Sparks } from '../components/Sparks';
import { FlowHint } from '../components/FlowHint';
import { useNetwork } from '../lib/network';

const STEPS = [
  { num: '01', tag: 'Connect', title: 'Link a wallet', body: 'Scan one QR code with your Bitcoin Cash wallet. No account, no sign-up.' },
  { num: '02', tag: 'Fill', title: 'Fill the envelope', body: 'Pick an amount, how many people can open it, and a message.' },
  { num: '03', tag: 'Drop', title: 'Drop the link', body: 'Paste one link into your group chat. That link is the envelope.' },
  { num: '04', tag: 'Open', title: 'Race to open', body: 'First come, first served. Shares land in seconds, with a Hongbao Seal.' },
];

const MODES = [
  { theme: 'classic-red' as const, tag: 'Equal', title: 'Fair split', body: 'Everyone who opens it gets the same share.' },
  { theme: 'gold' as const, tag: 'Lucky', title: 'Lucky draw', body: 'Random amounts. Someone walks away the luckiest.' },
  { theme: 'lunar' as const, tag: 'Quiz', title: 'Answer to open', body: 'Ask a question. Only the right answer opens it.' },
];

const WHY: [string, string][] = [
  ['One link, the whole group', 'Drop one link in the chat. The first N people to open it each get a share.'],
  ['Rules on-chain', 'A contract holds the money, so nobody, not even the sender, can take it back before it expires.'],
  ['Leftovers come home', 'Shares nobody opened return to the sender automatically.'],
  ['Lucky and quiz modes', 'Random amounts for a lucky draw, or a question people answer to open it.'],
  ['A Hongbao Seal each', 'Every person who opens a share also gets a Hongbao Seal NFT in their wallet.'],
  ['Sponsored Drops', 'Brands put their name on envelopes and see their cost per activated new wallet, checkable on-chain.'],
];

/** Hide the hero counters until there's this much to show (mainnet starts from an empty database). */
export const MIN_ENVELOPES_FOR_STATS = 5;

/** What the hero shows where the counters go: the numbers, one neutral line, or nothing. */
export function statsMode(stats: Pick<GlobalStats, 'envelopes'> | null, network: Network | null): 'numbers' | 'line' | 'none' {
  if (!stats) return 'none'; // loading or failed: nothing rather than dashes
  if (stats.envelopes >= MIN_ENVELOPES_FOR_STATS) return 'numbers';
  return network === 'MAINNET' ? 'line' : 'none';
}

export interface HeroCta {
  label: string;
  /** In-app route (Link) or full URL (plain link). */
  to: string;
  external: boolean;
}
/** Main + secondary hero buttons, and the reassurance line. A demo envelope makes "Try it free" the main action. */
export function heroCtas(demoUrl: string): { primary: HeroCta; secondary: HeroCta; note: string | null } {
  return demoUrl
    ? {
        primary: { label: 'Try it free', to: demoUrl, external: true },
        secondary: { label: 'Send your own', to: '/send', external: false },
        note: 'No BCH needed to try it. All you need is a BCH wallet, like Paytaca.',
      }
    : {
        primary: { label: 'Send a drop', to: '/send', external: false },
        secondary: { label: 'How it works', to: '/#how', external: false },
        note: null,
      };
}

function CtaButton({ cta, className }: { cta: HeroCta; className: string }) {
  return cta.external ? (
    <a href={cta.to} className={className}>
      {cta.label}
    </a>
  ) : (
    <Link to={cta.to} className={className}>
      {cta.label}
    </Link>
  );
}

export function Landing() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const { cfg } = useNetwork();
  const root = useReveal<HTMLDivElement>();
  const ctas = heroCtas(DEMO_URL);
  const showStats = statsMode(stats, cfg?.network ?? null);
  useEffect(() => {
    api.globalStats().then(setStats).catch(() => {});
  }, []);

  return (
    <div ref={root}>
      {/* ------------------------------------------------------------ hero */}
      <section className="hero" aria-labelledby="hero-title">
        <Sparks count={14} />
        <Dragon />
        <div className="hero-copy">
          <p className="eyebrow">Hongbao: red envelopes of Bitcoin Cash</p>
          <h1 id="hero-title" className="disp disp-xl">
            Drop luck
            <br />
            <span className="flame">into the chat</span>
          </h1>
          <FlowHint />
          <p className="lead hero-lead">
            Fill a red envelope with BCH and share it as one link. The first friends to open it each get a share and a
            Hongbao Seal. They don't need any BCH, and they sign nothing.
          </p>
          <div className="row hero-ctas">
            <CtaButton cta={ctas.primary} className="btn btn-primary btn-lg" />
            <CtaButton cta={ctas.secondary} className="btn btn-ghost btn-lg" />
          </div>
          {ctas.note && <p className="hero-note">{ctas.note}</p>}
        </div>

        {showStats === 'numbers' && stats && (
          <div className="hero-stats">
            <Stat value={stats.envelopes} label="Envelopes dropped" />
            <Stat value={stats.claims} label="Shares opened" />
            <Stat value={stats.newWalletsOnboarded} label="New wallets" />
            <Stat value={stats.bchGiftedSats} label="BCH gifted" format={(n) => fmtBch(Math.round(n), 5)} />
            <Stat value={stats.passOnEnvelopes} label="Passed on" />
          </div>
        )}
        {showStats === 'line' && <p className="hero-live">Live on Bitcoin Cash mainnet</p>}
      </section>

      {/* ------------------------------------------------------------ how */}
      <section id="how" className="section has-sparks" aria-labelledby="how-title">
        <Sparks count={10} />
        <div className="container">
          <p className="eyebrow reveal">Hongbao drops · how it works</p>
          <h2 id="how-title" className="disp disp-lg reveal">
            Four steps to
            <br />
            <span className="flame">the drop</span>
          </h2>
          <div className="grid-4" style={{ marginTop: 32 }}>
            {STEPS.map((s, i) => (
              <article key={s.num} className="card step-card reveal" style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="disp flame" style={{ fontSize: 56, lineHeight: 1 }}>
                  {s.num}
                </span>
                <div style={{ marginTop: 16 }}>
                  <span className="tag">{s.tag}</span>
                </div>
                <h3 className="disp disp-sm" style={{ marginTop: 8 }}>
                  {s.title}
                </h3>
                <p style={{ margin: '12px 0 0' }}>{s.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ modes */}
      <section className="section modes-section has-sparks" aria-labelledby="modes-title">
        <Sparks count={14} />
        <div className="container">
          <p className="eyebrow reveal">Three ways to play</p>
          <h2 id="modes-title" className="disp disp-lg reveal">
            Pick your <span className="flame">mode</span>
          </h2>
          <div className="modes">
            {MODES.map((m, i) => (
              <article key={m.tag} className="mode-card reveal" style={{ transitionDelay: `${i * 110}ms` }}>
                <div className="mode-env">
                  <Envelope theme={m.theme} size={130} sealText={m.tag.toUpperCase()} />
                </div>
                <span className="tag tag-bright">{m.tag}</span>
                <h3 className="disp disp-sm" style={{ marginTop: 10 }}>
                  {m.title}
                </h3>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  {m.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ safety */}
      <section id="why" className="section why has-sparks" aria-labelledby="why-title">
        <Sparks count={10} />
        <div className="container">
          <p className="eyebrow reveal">Why Hongbao?</p>
          <h2 id="why-title" className="disp disp-lg reveal">
            Made for the <span className="flame">group chat</span>
          </h2>
          <div className="why-frame reveal">
            <p>
              <span className="why-q">Gifting one friend, maybe on paper?</span>
              <span className="why-a">CashStamps is perfect.</span>
            </p>
            <p className="why-us">
              <span className="why-q">Dropping into a group of 50?</span>
              <span className="why-a">That's Hongbao.</span>
            </p>
          </div>
          <ul className="why-grid">
            {WHY.map(([t, b], i) => (
              <li key={t} className="card why-card reveal" style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
                <h3>{t}</h3>
                <p className="muted">{b}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="safety" className="section safety has-sparks" aria-labelledby="safety-title">
        <Sparks count={9} />
        <div className="container safety-grid">
          <div>
            <p className="eyebrow reveal">Plain words</p>
            <h2 id="safety-title" className="disp disp-lg reveal">
              Where does
              <br />
              <span className="flame">the money sit?</span>
            </h2>
            <p className="lead reveal" style={{ marginTop: 20 }}>
              In a <strong>lockbox</strong> on the Bitcoin Cash network. Not with us, and not in anyone's account.
            </p>
          </div>
          <ul className="safety-list">
            {[
              ['Nobody can grab it early', "Once it's sealed, not even the sender can take it back before it expires."],
              ['Leftovers return automatically', "Shares nobody opened go back to the sender about an hour after the envelope expires. Nobody has to press a button."],
              ['Openers sign nothing', 'No fees, no approvals, no BCH needed. Paste an address or connect a wallet and the share arrives.'],
              ['One share each', 'Whoever has the link can open it, but each person gets one share.'],
              ['A Hongbao Seal to keep', 'Every share comes with a Hongbao Seal that shows up in your wallet.'],
            ].map(([t, b], i) => (
              <li key={t} className="reveal" style={{ transitionDelay: `${i * 70}ms` }}>
                <span className="safety-ico" aria-hidden="true">
                  ◆
                </span>
                <div>
                  <strong>{t}</strong>
                  <p className="muted">{b}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ extras */}
      <section className="section has-sparks" aria-labelledby="extras-title">
        <Sparks count={10} />
        <div className="container">
          <p className="eyebrow reveal">More than a tip</p>
          <h2 id="extras-title" className="disp disp-lg reveal">
            Keep it <span className="flame">moving</span>
          </h2>
          <div className="grid-2 extras" style={{ marginTop: 32 }}>
            <article className="card reveal">
              <span className="tag">Pass it on</span>
              <h3 className="disp disp-sm" style={{ marginTop: 10 }}>
                Gift it forward
              </h3>
              <p>
                Opened one? Re-gift part of it as a new envelope. Every drop grows a tree, and you can watch how far your luck
                travels.
              </p>
            </article>
            <article className="card reveal" style={{ transitionDelay: '90ms' }}>
              <span className="tag">Hold my share</span>
              <h3 className="disp disp-sm" style={{ marginTop: 10 }}>
                No wallet yet?
              </h3>
              <p>We hold your share for 15 minutes while you set one up. Try Paytaca. Come back and it's still yours.</p>
            </article>
            <article className="card reveal">
              <span className="tag">Sponsored drops</span>
              <h3 className="disp disp-sm" style={{ marginTop: 10 }}>
                Brands, meet wallets
              </h3>
              <p>
                Put your logo on envelopes and see how many brand-new wallets you reached, with every number checkable on-chain.{' '}
                <Link to="/sponsor">Learn more</Link>
              </p>
            </article>
            <article className="card reveal" style={{ transitionDelay: '90ms' }}>
              <span className="tag">Hongbao Seals</span>
              <h3 className="disp disp-sm" style={{ marginTop: 10 }}>
                Proof you were there
              </h3>
              <div className="seal-row">
                {(['lunar', 'classic-red', 'gold', 'christmas'] as const).map((t) => (
                  <img key={t} src={`/themes/${t}.png`} alt={`${t} Hongbao Seal`} loading="lazy" />
                ))}
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ for sponsors */}
      <section id="sponsors" className="section has-sparks" aria-labelledby="sponsors-title">
        <Sparks count={8} />
        <div className="container">
          <p className="eyebrow reveal">For sponsors</p>
          <h2 id="sponsors-title" className="disp disp-lg reveal">
            Pay for <span className="flame">real wallets</span>, not clicks
          </h2>
          <div className="plans">
            <article className="card plan reveal">
              <span className="tag">Personal drops</span>
              <p className="plan-price">Free</p>
              <p className="muted">
                No fee from us. You only pay the Bitcoin Cash network fee to send it, well under one US cent. Opening one is
                always free.
              </p>
            </article>
            <article className="card plan plan-hot reveal" style={{ transitionDelay: '90ms' }}>
              <span className="tag">Sponsored drops</span>
              <p className="plan-price">
                3% <small>of the drop · min 546 sats</small>
              </p>
              <ul className="plan-list">
                <li>Your logo, colour and link on every envelope</li>
                <li>A live dashboard: claims, brand-new wallets, who used their BCH within 7 days, suspected farming</li>
                <li>
                  <span>
                    Your <strong>cost per activated new wallet</strong>, the number that matters
                  </span>
                </li>
                <li>A public proof page: every number links to its transaction on the blockchain</li>
                <li>Self-serve: set it up in minutes, no sales call</li>
              </ul>
              <Link to="/sponsor" className="btn btn-primary btn-block" style={{ marginTop: 20 }}>
                Start a sponsored drop
              </Link>
            </article>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ cta */}
      <section className="cta-band" aria-labelledby="cta-title">
        <div className="container cta-inner">
          <div>
            <h2 id="cta-title" className="disp disp-lg">
              Ready to drop?
            </h2>
            <p className="cta-sub">It takes about a minute. Your friends need nothing but the link.</p>
          </div>
          <Link to="/send" className="btn btn-black btn-lg">
            Send a drop
          </Link>
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label, format = (n) => Math.round(n).toLocaleString('en-US') }: { value: number; label: string; format?: (n: number) => string }) {
  return (
    <div className="stat">
      <p className="num disp flame" style={{ margin: 0 }}>
        <CountUp value={value} format={format} />
      </p>
      <p className="lbl">{label}</p>
    </div>
  );
}
