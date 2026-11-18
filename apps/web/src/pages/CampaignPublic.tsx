import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { PublicCampaignStats } from '@hongbao/shared';
import { api, errorText } from '../lib/api';
import { CampaignView } from '../components/CampaignView';
import { Spinner } from '../components/ui';

export function CampaignPublic() {
  const { campaignId } = useParams();
  const [s, setS] = useState<PublicCampaignStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.campaignPublic(campaignId!).then(setS).catch((e) => setErr(errorText(e)));
  }, [campaignId]);
  return (
    <div className="page">
      <div className="container">
        <p className="eyebrow">Proof of reach</p>
        {err ? (
          <div className="alert alert-error">{err}</div>
        ) : s ? (
          <CampaignView s={s} isPublic />
        ) : (
          <Spinner size={32} />
        )}
        <p style={{ marginTop: 32 }}>
          <Link to="/sponsor">Run your own sponsored drop →</Link>
        </p>
      </div>
    </div>
  );
}
