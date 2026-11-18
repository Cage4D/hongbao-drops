import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useNetwork } from '../lib/network';
import { PAYTACA_URL } from '../lib/config';
import { ConnectModal, WalletButton } from './ConnectModal';

export function Layout() {
  const { pathname, hash } = useLocation();
  // Scroll to top on page change (but keep in-page #anchors and the #k= link secret alone).
  useEffect(() => {
    if (!hash || hash.startsWith('#k=')) window.scrollTo(0, 0);
  }, [pathname, hash]);
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
          <NavLink to="/" end>
            Home
          </NavLink>
          <a href="/#how">How it works</a>
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
            <a className="flink" href="/#how">How it works</a>
            <a className="flink" href="/#safety">Is it safe?</a>
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
