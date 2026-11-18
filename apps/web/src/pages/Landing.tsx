import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { GlobalStats } from '@hongbao/shared';
import { api } from '../lib/api';
import { DEMO_URL } from '../lib/config';
import { fmtBch } from '../lib/format';
import { useReveal } from '../lib/hooks';
import { Dragon } from '../components/Dragon';
import { Envelope } from '../components/Envelope';
import { CountUp } from '../components/ui';
import { Sparks } from '../components/Sparks';

const STEPS = [
  { num: '01', tag: 'Connect', title: 'Link a wallet', body: 'Scan one QR code with your Bitcoin Cash wallet. No account, no sign-up.' },
  { num: '02', tag: 'Fill', title: 'Fill the envelope', body: 'Pick an amount, how many people can open it, and a message.' },
  { num: '03', tag: 'Drop', title: 'Drop the link', body: 'Paste one link into your group chat. That link is the envelope.' },
  { num: '04', tag: 'Open', title: 'Race to open', body: 'First come, first served. Shares land in seconds, with a collectible stamp.' },
];

const MODES = [
  { theme: 'classic-red' as const, tag: 'Equal', title: 'Fair split', body: 'Everyone who opens it gets the same share.' },
  { theme: 'gold' as const, tag: 'Lucky', title: 'Lucky draw', body: 'Random amounts. Someone walks away the luckiest.' },
  { theme: 'lunar' as const, tag: 'Quiz', title: 'Answer to open', body: 'Ask a question. Only the right answer opens it.' },
];

export function Landing() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const root = useReveal<HTMLDivElement>();
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
          <span className="tag hero-tag">
            <span className="dot" />
            {DEMO_URL ? 'A drop is live now' : 'Lunar New Year · Hongbao'}
          </span>
          <p className="eyebrow">Red envelopes of Bitcoin Cash</p>
          <h1 id="hero-title" className="disp disp-xl">
            Drop luck
            <br />
            <span className="flame">into the chat</span>
          </h1>
          <p className="lead hero-lead">
            Fill a red envelope with BCH and share it as one link. The first friends to open it each get a share and a collectible
            stamp. They don't need any BCH, and they sign nothing.
          </p>
          <div className="row hero-ctas">
            {DEMO_URL ? (
              <>
                <a href={DEMO_URL} className="btn btn-primary btn-lg">
                  Try it
                </a>
                <Link to="/send" className="btn btn-ghost btn-lg">
                  Send your own
                </Link>
              </>
            ) : (
              <>
                <Link to="/send" className="btn btn-primary btn-lg">
                  Send a drop
                </Link>
                <Link to="/#how" className="btn btn-ghost btn-lg">
                  How it works
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="hero-stats">
          <Stat value={stats?.envelopes ?? null} label="Envelopes dropped" />
          <Stat value={stats?.claims ?? null} label="Shares opened" />
          <Stat value={stats?.newWalletsOnboarded ?? null} label="New wallets" />
          <Stat value={stats ? stats.bchGiftedSats : null} label="BCH gifted" format={(n) => fmtBch(Math.round(n), 5)} />
        </div>
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
              ['A stamp to keep', 'Every share comes with a collectible stamp that shows up in your wallet.'],
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
              <p>We hold your share for 15 minutes while you set up a wallet (we suggest Paytaca). Come back and it's still yours.</p>
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
              <span className="tag">Collectible stamps</span>
              <h3 className="disp disp-sm" style={{ marginTop: 10 }}>
                Proof you were there
              </h3>
              <div className="stamp-row">
                {(['lunar', 'classic-red', 'gold', 'christmas'] as const).map((t) => (
                  <img key={t} src={`/themes/${t}.png`} alt={`${t} stamp`} loading="lazy" />
                ))}
              </div>
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

function Stat({ value, label, format = (n) => Math.round(n).toLocaleString('en-US') }: { value: number | null; label: string; format?: (n: number) => string }) {
  return (
    <div className="stat">
      <p className="num disp flame" style={{ margin: 0 }}>
        <CountUp value={value} format={format} />
      </p>
      <p className="lbl">{label}</p>
    </div>
  );
}
