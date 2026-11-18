// A one-shot celebration: coins and embers burst from a point, then fall. Fire it by bumping `fire`.
import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../lib/hooks';

const COLORS = ['#00e0ff', '#3da9ff', '#ebfcff', '#ffd666', '#ffc93d', '#0066ff'];

export function Burst({ fire, originY = 0.45 }: { fire: number; originY?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!fire || prefersReducedMotion()) return;
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = (c.width = Math.round(c.clientWidth * dpr));
    const h = (c.height = Math.round(c.clientHeight * dpr));
    type P = { x: number; y: number; vx: number; vy: number; r: number; c: string; coin: boolean; rot: number; vr: number; life: number };
    const ps: P[] = [];
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (4 + Math.random() * 11) * dpr;
      const coin = Math.random() < 0.35;
      ps.push({
        x: w / 2,
        y: h * originY,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 6 * dpr,
        r: (coin ? 5 + Math.random() * 4 : 1.5 + Math.random() * 2.5) * dpr,
        c: coin ? '#ffc93d' : COLORS[i % COLORS.length]!,
        coin,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        life: 0,
      });
    }
    let raf = 0;
    const step = () => {
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of ps) {
        p.life++;
        p.vy += 0.28 * dpr;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        const a = Math.max(0, 1 - p.life / 110);
        if (a <= 0 || p.y > h + 20) continue;
        alive++;
        ctx.globalAlpha = a;
        if (p.coin) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.scale(Math.abs(Math.cos(p.rot)) + 0.15, 1);
          ctx.fillStyle = p.c;
          ctx.shadowColor = '#ffb000';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(0, 0, p.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#b37400';
          ctx.lineWidth = dpr;
          ctx.strokeRect(-p.r * 0.3, -p.r * 0.3, p.r * 0.6, p.r * 0.6);
          ctx.restore();
        } else {
          ctx.fillStyle = p.c;
          ctx.shadowColor = '#00a3ff';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      ctx.globalAlpha = 1;
      if (alive) raf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [fire, originY]);
  return <canvas ref={ref} className="burst" aria-hidden="true" />;
}
