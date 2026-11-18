// "This drop reached X people across Y generations" (GET /envelopes/:id/tree).
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { TreeNode, TreeResponse } from '@hongbao/shared';
import { api } from '../lib/api';
import { fmtSats } from '../lib/format';
import { THEMES } from './Envelope';

export function DropTree({ envelopeId }: { envelopeId: string }) {
  const [tree, setTree] = useState<TreeResponse | null>(null);
  useEffect(() => {
    api.tree(envelopeId).then(setTree).catch(() => setTree(null));
  }, [envelopeId]);

  const gens = useMemo(() => {
    if (!tree) return [];
    const by: TreeNode[][] = [];
    for (const n of tree.nodes) (by[n.generation] ??= []).push(n);
    return by.filter(Boolean);
  }, [tree]);

  if (!tree || tree.nodes.length < 2) return null;
  return (
    <section className="tree section" aria-labelledby="tree-title">
      <p className="eyebrow">Pass it on</p>
      <h2 id="tree-title" className="disp disp-md">
        This drop reached <span className="flame">{tree.totalReach} {tree.totalReach === 1 ? 'person' : 'people'}</span>
        <br />
        across {tree.generations} {tree.generations === 1 ? 'generation' : 'generations'}
      </h2>
      <p className="muted" style={{ marginTop: 12 }}>
        {tree.passOnEnvelopes} {tree.passOnEnvelopes === 1 ? 'envelope was' : 'envelopes were'} passed on from it.
      </p>
      <div className="tree-gens">
        {gens.map((g, gi) => (
          <div key={gi} className="tree-gen">
            <span className="tag tag-dark">{gi === 0 ? 'Original' : `Gen ${gi}`}</span>
            <div className="tree-nodes">
              {g.map((n) => (
                <Link
                  key={n.id}
                  to={`/e/${n.id}`}
                  className={`tree-node ${n.id === tree.focusId ? 'focus' : ''}`}
                  style={{ '--node': THEMES[n.theme]?.from ?? '#0066ff' } as CSSProperties}
                  title={`${n.claims} of ${n.shareCount} opened · ${fmtSats(n.totalSats)} sats`}
                >
                  <span className="tree-env" aria-hidden="true" />
                  <span className="small">
                    {n.claims}/{n.shareCount}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>
        Opening a passed-on envelope still needs its own link from whoever passed it on.
      </p>
    </section>
  );
}
