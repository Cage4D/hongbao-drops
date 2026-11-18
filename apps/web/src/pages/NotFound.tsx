import { Link } from 'react-router';
import { Envelope } from '../components/Envelope';

export function NotFound({ what = 'page' }: { what?: 'page' | 'envelope' }) {
  return (
    <div className="page narrow center stack" style={{ paddingBottom: 64 }}>
      <div style={{ display: 'grid', placeItems: 'center', opacity: 0.6 }}>
        <Envelope theme="lunar" size={140} sealText="?" />
      </div>
      <h1 className="disp disp-lg">
        Lost in the <span className="flame">smoke</span>
      </h1>
      <p className="lead">
        {what === 'envelope'
          ? "We couldn't find that envelope. Check the link was copied in full, or ask the sender to send it again."
          : "There's nothing at this address."}
      </p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn btn-primary" to="/">
          Home
        </Link>
        <Link className="btn btn-ghost" to="/send">
          Send a drop
        </Link>
      </div>
    </div>
  );
}
