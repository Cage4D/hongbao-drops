// The spirit dragon from the Blue Dragon design.
//
// Performance: everything that moves is a CSS animation of transform/opacity on its own layer, so
// the compositor runs it off the main thread and scrolling never waits on it. No live filters, blur
// or blend modes: the glow is pre-rendered (tools/bake-dragon.mjs) and the flames "lick" by
// cross-fading two copies of the outer ring that sway at different speeds. JS only drives the
// ember canvas (sprites, 1× resolution, paused offscreen and while scrolling). The dragon ignores
// the cursor; it only floats on its own (the CSS breathing loop on .dr-body).
import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../lib/hooks';

export function Dragon({ intensity = 1, className = '' }: { intensity?: number; className?: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const k = useRef(intensity);
  k.current = intensity;

  useEffect(() => {
    const el = stage.current;
    if (!el || prefersReducedMotion()) return;
    const canvas = el.querySelector('.dr-embers') as HTMLCanvasElement | null;

    let visible = true;
    const io = new IntersectionObserver(([en]) => (visible = !!en?.isIntersecting));
    io.observe(el);
    let scrollingUntil = 0;
    const onScroll = () => (scrollingUntil = performance.now() + 150);
    window.addEventListener('scroll', onScroll, { passive: true });

    const sprite = (core: string) => {
      const s = document.createElement('canvas');
      s.width = s.height = 32;
      const g = s.getContext('2d')!;
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, core);
      grad.addColorStop(0.25, core);
      grad.addColorStop(0.45, 'rgba(0, 163, 255, 0.45)');
      grad.addColorStop(1, 'rgba(0, 163, 255, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      return s;
    };
    const hot = sprite('#ebfcff');
    const cool = sprite('#00e0ff');

    const ctx = canvas?.getContext('2d');
    type Ember = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number };
    const embers: Ember[] = [];
    let t0 = 0;
    /** Fractional embers carried between frames (the rate scales with the dragon's size). */
    let owed = 0;
    const tick = (time: number) => {
      // time is in seconds (from the requestAnimationFrame loop below).
      if (!visible || !canvas || !ctx) return;
      // Skip ember frames while scrolling: the main thread belongs to the scroll then.
      if (performance.now() < scrollingUntil) {
        t0 = time;
        return;
      }
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      const dt = t0 ? Math.min(0.05, time - t0) : 0.016;
      t0 = time;
      // The hero sizes the dragon to the screen, so keep the embers' density and reach what they
      // were at full size (1180 px wide): spawn rate ∝ drawn area, drift speed ∝ width.
      const scale = Math.min(1, w / 1180);
      owed += 0.9 * 2 * k.current * scale * scale;
      const spawn = Math.floor(owed);
      owed -= spawn;
      {
        for (let s = 0; s < spawn; s++) {
          const ang = Math.random() * Math.PI * 2;
          embers.push({
            x: w * (0.5 + Math.cos(ang) * (0.22 + Math.random() * 0.12)),
            y: h * (0.55 + Math.sin(ang) * (0.3 + Math.random() * 0.1)),
            vx: (Math.random() - 0.5) * 30 * scale,
            vy: (-30 - Math.random() * 70) * Math.max(scale, 0.5),
            life: 0,
            max: 1.2 + Math.random() * 1.8,
            r: Math.random() < 0.3 ? 2.5 : 1.5,
          });
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i]!;
        e.life += dt;
        if (e.life > e.max) {
          embers.splice(i, 1);
          continue;
        }
        e.vx += Math.sin(e.y * 0.03 + time * 2) * 20 * scale * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const a = 1 - e.life / e.max;
        ctx.globalAlpha = a;
        const d = e.r * 5;
        ctx.drawImage(a > 0.6 ? hot : cool, e.x - d / 2, e.y - d / 2, d, d);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
    let raf = 0;
    const loop = (ms: number) => {
      tick(ms / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      io.disconnect();
    };
  }, []);

  return (
    <div
      ref={stage}
      className={`dragon ${className}`}
      role="img"
      aria-label="A spirit dragon made of electric blue flame, staring straight ahead with glowing cyan eyes"
    >
      <div className="dr-halo" aria-hidden="true" />
      <canvas className="dr-embers dr-layer" aria-hidden="true" />
      <div className="dr-body dr-layer">
        <DragonImg className="dr-layer dr-core" priority />
        <DragonImg className="dr-layer dr-flames dr-flames-a" />
        <DragonImg className="dr-layer dr-flames dr-flames-b" />
        <img className="dr-layer dr-bloom" src="/dragon-bloom.webp" alt="" decoding="async" />
        <span className="dr-eye" style={{ left: '47.7%', top: '52.6%' }} />
        <span className="dr-eye dr-eye-r" style={{ left: '54.6%', top: '52.6%' }} />
      </div>
    </div>
  );
}

/**
 * The dragon art at the right size. Phones always get the 800 px file: the dragon is ~500 CSS px
 * there, and 3× screens would otherwise pull the 1600 px one (420 KB) for soft, glowing art.
 * Elsewhere `sizes` follows the hero's sizing (the dragon's width tracks the screen height, see
 * .hero in pages.css), so 1× screens get 800 px and 2× screens 1600 px. All three layers use the
 * same URL, so it downloads once.
 */
function DragonImg({ className, priority }: { className: string; priority?: boolean }) {
  return (
    <picture>
      <source media="(max-width: 640px)" srcSet="/dragon-800.webp" />
      <img
        className={className}
        src="/dragon.webp"
        srcSet="/dragon-800.webp 800w, /dragon.webp 1600w"
        sizes="clamp(320px, calc(173vh - 985px), 1180px)"
        alt=""
        decoding="async"
        {...(priority && { fetchPriority: 'high' as const })}
      />
    </picture>
  );
}
