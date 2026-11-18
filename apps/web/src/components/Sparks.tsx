// Little fire sparks drifting up through a section. Pure CSS animation (transform + opacity on
// tiny promoted layers), so they run on the compositor and never compete with scrolling. Each
// spark gets random position, size, speed, drift and delay; the set pauses while offscreen.
// Put <Sparks /> as the first child of an element with the `has-sparks` class.
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function Sparks({ count = 12, tone = 'blue' }: { count?: number; tone?: 'blue' | 'light' }) {
  const ref = useRef<HTMLDivElement>(null);

  const sparks = useMemo(
    () =>
      Array.from({ length: count }, () => {
        const dur = rand(4.5, 9);
        return {
          left: `${rand(2, 98).toFixed(1)}%`,
          // Mostly from the bottom edge, some starting part-way up the section.
          bottom: Math.random() < 0.6 ? '-12px' : `${rand(5, 45).toFixed(0)}%`,
          size: `${rand(2, 4.5).toFixed(1)}px`,
          dur: `${dur.toFixed(2)}s`,
          // Negative delay = already mid-flight on load, so they don't all start at the bottom.
          delay: `${(-rand(0, dur)).toFixed(2)}s`,
          rise: `${Math.round(rand(160, 420))}px`,
          drift: `${Math.round(rand(-60, 60))}px`,
          sway: `${Math.round(rand(-18, 18))}px`,
          peak: rand(0.55, 1).toFixed(2),
          hot: Math.random() < 0.3,
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
              '--peak': s.peak,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
