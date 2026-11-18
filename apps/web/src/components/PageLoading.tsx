// Shown while a page's code loads (pages are split out of the landing bundle).
import { Envelope } from './Envelope';

export function PageLoading() {
  return (
    <div className="page page-loading" role="status" aria-live="polite">
      <div className="page-loading-env" aria-hidden="true">
        <Envelope theme="lunar" size={96} sealText="" />
      </div>
      <p className="eyebrow">Loading…</p>
    </div>
  );
}
