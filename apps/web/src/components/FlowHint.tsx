// A tiny looping picture of the product under the hero headline: a link is dropped, a red envelope
// opens, "+2,148 sats + Hongbao Seal". Decorative (aria-hidden): the text around it says the same.
// Compositor-only CSS animation (transform/opacity), paused offscreen; still for reduced motion.
import { useEffect, useRef } from 'react';
import { Envelope } from './Envelope';

export function FlowHint() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([en]) => el.classList.toggle('flow-paused', !en?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="flow" ref={ref} aria-hidden="true">
      <span className="flow-chip flow-link">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
        <span className="flow-url">…/k7m2qp</span>
      </span>
      <span className="flow-arrow flow-arrow-1">›</span>
      <span className="flow-env">
        <Envelope theme="classic-red" size={30} sealText="" inline />
      </span>
      <span className="flow-arrow flow-arrow-2">›</span>
      <span className="flow-chip flow-got">
        <strong>+2,148 sats</strong>
        <span className="flow-seal">+ Hongbao Seal</span>
      </span>
    </div>
  );
}
