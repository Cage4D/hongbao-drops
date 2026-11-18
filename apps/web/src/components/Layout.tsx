import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useNetwork } from '../lib/network';
import { PAYTACA_URL } from '../lib/config';
import { ConnectModal, WalletButton } from './ConnectModal';

export function Layout() {
  const { pathname, hash, key } = useLocation();
  // On every navigation: go to the #section if there is one, else to the top. The section may not
  // exist yet (the page is still rendering, or the app just loaded), so retry for up to ~1.5 s.
  // `key` changes even when clicking a link to the location you're already on.
  useEffect(() => {
    const id = hash && !hash.startsWith('#k=') ? decodeURIComponent(hash.slice(1)) : null;
    if (!id) {
      window.scrollTo(0, 0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (performance.now() - start < 1500) raf = requestAnimationFrame(tryScroll);
      else window.scrollTo(0, 0); // no such section on this page: don't leave the user mid-page
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [pathname, hash, key]);
  return (
    <>
      <Nav />
      <main id="main">
        <Outlet />
      </main>
      <Footer />
      <ConnectModal />
    </>
  );
}

function Nav() {
  const { cfg } = useNetwork();
  const { pathname, hash } = useLocation();
  const onHow = pathname === '/' && hash === '#how';
  return (
    <header className="nav">
      <nav aria-label="Main" className="nav-inner">
        <Link to="/" className="disp nav-brand">
          Hongbao Drops
        </Link>
        {cfg?.network === 'CHIPNET' && (
          <span className="net-pill test nav-hide-sm" title="Test network: coins have no value">
            Test network
          </span>
        )}
        <div className="nav-links">
          <NavLink to="/" end className={({ isActive }) => (isActive && !onHow ? 'active' : '')}>
            Home
          </NavLink>
          <Link to="/#how" className={onHow ? 'active' : ''} aria-current={onHow ? 'location' : undefined}>
            How it works
          </Link>
          <NavLink to="/sponsor">Sponsors</NavLink>
        </div>
        <div className="nav-actions">
          <Link to="/send" className="btn btn-primary btn-sm nav-hide-xs">
            Send a drop
          </Link>
          <WalletButton />
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-cols">
          <div>
            <Link to="/" className="disp" style={{ display: 'inline-block', fontSize: 26, textDecoration: 'none' }}>
              Hongbao Drops
            </Link>
            <p className="small muted" style={{ marginTop: 16 }}>
              Red envelopes of Bitcoin Cash, dropped into your group chat as one link.
            </p>
          </div>
          <FooterCol title="Drops">
            <Link className="flink" to="/send">Send a drop</Link>
            <Link className="flink" to="/#how">How it works</Link>
            <Link className="flink" to="/#safety">Is it safe?</Link>
          </FooterCol>
          <FooterCol title="Sponsors">
            <Link className="flink" to="/sponsor">Sponsored drops</Link>
            <Link className="flink" to="/sponsor#dashboard">Dashboard</Link>
          </FooterCol>
          <FooterCol title="Wallet">
            <a className="flink" href={PAYTACA_URL} target="_blank" rel="noreferrer">Get Paytaca</a>
            <a className="flink" href="https://bch.info" target="_blank" rel="noreferrer">About Bitcoin Cash</a>
          </FooterCol>
        </div>
        <div className="small muted" style={{ marginTop: 48, paddingTop: 16, borderTop: '1px solid var(--surface)' }}>
          © 2026 Hongbao Drops · Built for BCH BLAZE 2026
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: 10 }}>
        {title}
      </p>
      {children}
    </div>
  );
}
