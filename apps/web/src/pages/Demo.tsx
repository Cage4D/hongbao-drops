// The stable demo link: /demo#k=<shared demo link key>. Every daily demo envelope reuses that key
// (scripts/src/demo-envelope.ts), so this page only asks the API which envelope is open now and
// moves to /<slug>, keeping the #k= fragment. The key never leaves the browser.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { Envelope } from '../components/Envelope';

export function Demo() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'none' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    api
      .demo()
      .then((d) => {
        if (!live) return;
        if (d.slug) navigate(`/${d.slug}${hash}`, { replace: true });
        else setState('none');
      })
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [hash, navigate]);

  if (state === 'loading') {
    return (
      <div className="page narrow center stack" aria-busy="true">
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <Envelope theme="lunar" size={140} />
        </div>
        <p className="lead">Finding today's free drop…</p>
      </div>
    );
  }
  return (
    <div className="page narrow center stack">
      <div style={{ display: 'grid', placeItems: 'center', opacity: 0.6 }}>
        <Envelope theme="lunar" size={140} sealText="…" />
      </div>
      <h1 className="disp disp-lg">
        Being <span className="flame">refilled</span>
      </h1>
      <p className="lead" role={state === 'error' ? 'alert' : undefined}>
        {state === 'none'
          ? "Today's free drop has been claimed or has run out. We top it up every day, so check back soon."
          : "Can't reach Hongbao Drops right now. Check your connection and try again."}
      </p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn btn-primary" to="/send">
          Send a drop
        </Link>
        <Link className="btn btn-ghost" to="/">
          Home
        </Link>
      </div>
    </div>
  );
}
