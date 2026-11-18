// Little fire sparks drifting up through a section. Pure CSS animation (transform + opacity on
// tiny promoted layers), so they run on the compositor and never compete with scrolling.
//
// Motion is split across layers so a spark never stops:
//   .spark      one continuous rise (single keyframe segment, decelerating as it cools) + drift
//               + shrink, and its life fade (opacity)
//   .spark-core side-to-side sway on its own period (horizontal only, so the rise carries on
//               while it turns), and a fast flicker
// (CSS applies the timing function per keyframe segment, so multi-stop paths ease to a halt at
// every stop; that's why the rise is one segment.)
// Put <Sparks /> as the first child of an element with the `has-sparks` class.
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function Sparks({ count = 12, tone = 'blue' }: { count?: number; tone?: 'blue' | 'light' }) {
  const ref = useRef<HTMLDivElement>(null);

  const sparks = useMemo(
    () =>
      Array.from({ length: count }, () => {
        const hot = Math.random() < 0.3;
        // Hotter sparks are smaller-brighter and climb faster.
        const dur = hot ? rand(3.5, 6) : rand(5, 9.5);
        return {
          left: `${rand(2, 98).toFixed(1)}%`,
          // Mostly from the bottom edge, some starting part-way up the section.
          bottom: Math.random() < 0.6 ? '-12px' : `${rand(5, 45).toFixed(0)}%`,
          size: `${rand(2, 4.5).toFixed(1)}px`,
          dur: `${dur.toFixed(2)}s`,
          // Negative delay = already mid-flight on load, so they don't all start at the bottom.
          delay: `${(-rand(0, dur)).toFixed(2)}s`,
          rise: `${Math.round(rand(180, 440))}px`,
          drift: `${Math.round(rand(-70, 70))}px`,
          sway: `${rand(6, 20).toFixed(0)}px`,
          swayDur: `${rand(0.9, 2.2).toFixed(2)}s`,
          swayDelay: `${(-rand(0, 2)).toFixed(2)}s`,
          flicker: `${rand(0.12, 0.35).toFixed(2)}s`,
          peak: rand(0.6, 1).toFixed(2),
          hot,
        };
      }),
    [count],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([en]) => el.classList.toggle('sparks-paused', !en?.isIntersecting), { rootMargin: '100px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`sparks sparks-${tone}`} aria-hidden="true">
      {sparks.map((s, i) => (
        <span
          key={i}
          className={`spark ${s.hot ? 'spark-hot' : ''}`}
          style={
            {
              left: s.left,
              bottom: s.bottom,
              '--s': s.size,
              '--dur': s.dur,
              '--delay': s.delay,
              '--rise': s.rise,
              '--drift': s.drift,
              '--sway': s.sway,
              '--sway-dur': s.swayDur,
              '--sway-delay': s.swayDelay,
              '--flicker': s.flicker,
              '--peak': s.peak,
            } as CSSProperties
          }
        >
          <i className="spark-core" />
        </span>
      ))}
    </div>
  );
}
