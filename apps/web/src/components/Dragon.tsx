// The spirit dragon from the Blue Dragon design: breathing body, flickering bloom, warped flame
// edges (SVG turbulence), pulsing eyes and rising embers. Follows the pointer a little.
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '../lib/hooks';

export function Dragon({ intensity = 1, className = '', compact = false }: { intensity?: number; className?: string; compact?: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const k = useRef(intensity);
  k.current = intensity;

  useEffect(() => {
    const el = stage.current;
    if (!el || prefersReducedMotion()) return;
    const q = (s: string) => el.querySelector(s) as HTMLElement | null;
    const body = q('.dr-body'), bloom = q('.dr-bloom'), halo = q('.dr-halo');
    const eyes = el.querySelectorAll('.dr-eye');
    const turb = el.querySelector('.dr-turb'), dmap = el.querySelector('.dr-dmap');
    const canvas = q('.dr-embers') as HTMLCanvasElement | null;
    const tweens: gsap.core.Tween[] = [];
    tweens.push(gsap.to(body, { scale: 1.022, y: -8, duration: 3.4, ease: 'sine.inOut', repeat: -1, yoyo: true, transformOrigin: '50% 55%' }));
    tweens.push(gsap.to(halo, { opacity: 0.65, scale: 1.06, duration: 1.7, ease: 'sine.inOut', repeat: -1, yoyo: true }));
    tweens.push(gsap.to(eyes, { opacity: 0.55, scale: 0.85, duration: 1.2, ease: 'sine.inOut', repeat: -1, yoyo: true, stagger: 0.08 }));
    tweens.push(gsap.to(bloom, { opacity: 'random(0.18, 0.55)', duration: 'random(0.07, 0.2)', ease: 'none', repeat: -1, repeatRefresh: true }));

    // Pointer parallax (desktop only).
    const tilt = el.querySelector('.dr-tilt') as HTMLElement | null;
    const xTo = tilt ? gsap.quickTo(tilt, 'x', { duration: 1.2, ease: 'power3.out' }) : null;
    const yTo = tilt ? gsap.quickTo(tilt, 'y', { duration: 1.2, ease: 'power3.out' }) : null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !xTo || !yTo) return;
      const r = el.getBoundingClientRect();
      xTo(((e.clientX - r.left) / r.width - 0.5) * 18);
      yTo(((e.clientY - r.top) / r.height - 0.5) * 12);
    };
    window.addEventListener('pointermove', onMove);

    let visible = true;
    const io = new IntersectionObserver(([en]) => (visible = !!en?.isIntersecting));
    io.observe(el);

    // The flame warp (SVG turbulence + displacement over the whole image) is the expensive part:
    // every attribute change re-runs the filter. Update it ~12 times a second, and not at all
    // while the page is scrolling, so scrolling stays smooth.
    let scrollingUntil = 0;
    const onScroll = () => (scrollingUntil = performance.now() + 180);
    window.addEventListener('scroll', onScroll, { passive: true });
    const WARP_EVERY_MS = 1000 / 12;
    let lastWarp = 0;

    // Embers: draw a pre-rendered glow sprite instead of using canvas shadowBlur per particle.
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
    let t0 = 0, frame = 0;
    const tick = (time: number) => {
      if (!visible || !canvas || !ctx) return;
      const kk = k.current;
      frame++;
      const now = performance.now();
      if (turb && dmap && now > scrollingUntil && now - lastWarp >= WARP_EVERY_MS) {
        lastWarp = now;
        const fy = 0.04 + Math.sin(time * 2.1) * 0.008;
        turb.setAttribute('baseFrequency', `${(0.012 + Math.sin(time * 0.9) * 0.002).toFixed(4)} ${fy.toFixed(4)}`);
        if (frame % 4 === 0) turb.setAttribute('seed', String(frame % 200));
        dmap.setAttribute('scale', ((12 + Math.sin(time * 3.3) * 4) * kk).toFixed(1));
      }
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const dt = t0 ? Math.min(0.05, time - t0) : 0.016;
      t0 = time;
      const spawn = Math.round(3 * kk);
      for (let s = 0; s < spawn; s++) {
        const ang = Math.random() * Math.PI * 2;
        embers.push({
          x: w * (0.5 + Math.cos(ang) * (0.22 + Math.random() * 0.12)),
          y: h * (0.55 + Math.sin(ang) * (0.3 + Math.random() * 0.1)),
          vx: (Math.random() - 0.5) * 30,
          vy: -30 - Math.random() * 70,
          life: 0,
          max: 1.2 + Math.random() * 1.8,
          r: Math.random() < 0.3 ? 2.5 : 1.5,
        });
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i]!;
        e.life += dt;
        if (e.life > e.max) {
          embers.splice(i, 1);
          continue;
        }
        e.vx += Math.sin(e.y * 0.03 + time * 2) * 20 * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const a = 1 - e.life / e.max;
        ctx.globalAlpha = a;
        const d = e.r * 5; // sprite covers the core plus its glow
        ctx.drawImage(a > 0.6 ? hot : cool, e.x - d / 2, e.y - d / 2, d, d);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
    gsap.ticker.add(tick);
    return () => {
      tweens.forEach((t) => t.kill());
      gsap.ticker.remove(tick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
      io.disconnect();
    };
  }, []);

  return (
    <div
      ref={stage}
      className={`dragon ${compact ? 'dragon-compact' : ''} ${className}`}
      role="img"
      aria-label="A spirit dragon made of electric blue flame, staring straight ahead with glowing cyan eyes"
    >
      <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="dr-flame-warp" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence className="dr-turb" type="fractalNoise" baseFrequency="0.012 0.04" numOctaves={2} seed={3} result="noise" />
          <feDisplacementMap className="dr-dmap" in="SourceGraphic" in2="noise" scale={14} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div className="dr-halo" aria-hidden="true" />
      <canvas className="dr-embers dr-layer" aria-hidden="true" />
      <div className="dr-tilt dr-layer">
        <div className="dr-body dr-layer">
          <img className="dr-layer dr-core" src="/dragon.webp" alt="" fetchPriority="high" />
          <img className="dr-layer dr-flames" src="/dragon.webp" alt="" />
          <img className="dr-layer dr-bloom" src="/dragon.webp" alt="" />
          <span className="dr-eye" style={{ left: '47.7%', top: '52.6%' }} />
          <span className="dr-eye" style={{ left: '54.6%', top: '52.6%' }} />
        </div>
      </div>
    </div>
  );
}
