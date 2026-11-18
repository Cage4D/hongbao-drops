import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useCountUp, useNow } from '../lib/hooks';
import { fmtDuration } from '../lib/format';

export function Modal({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Countdown({ until, onDone, compact }: { until: number; onDone?: () => void; compact?: boolean }) {
  const now = useNow(1000);
  const left = Math.max(0, Math.round((until - now) / 1000));
  const done = useRef(false);
  useEffect(() => {
    if (left === 0 && !done.current) {
      done.current = true;
      onDone?.();
    }
  }, [left, onDone]);
  if (compact) return <>{fmtDuration(left)}</>;
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
  const cells = h >= 24 ? [[Math.floor(h / 24), 'd'], [h % 24, 'h'], [m, 'm']] : [[h, 'h'], [m, 'm'], [s, 's']];
  return (
    <span className="countdown" aria-label={`${fmtDuration(left)} left`}>
      {cells.map(([v, u]) => (
        <span key={u} className="cd-cell">
          <span className="cd-num">{String(v).padStart(2, '0')}</span>
          <span className="cd-unit">{u}</span>
        </span>
      ))}
    </span>
  );
}

export function CountUp({ value, format }: { value: number | null; format: (n: number) => string }) {
  const n = useCountUp(value);
  return <>{n === null ? '—' : format(n)}</>;
}

export function CopyField({ value, label = 'Copy', onCopied }: { value: string; label?: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copy-field">
      <input className="input mono" readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
      <button
        className={`btn ${done ? 'btn-ghost' : 'btn-primary'}`}
        onClick={() => {
          const ok = () => {
            setDone(true);
            onCopied?.();
            setTimeout(() => setDone(false), 1800);
          };
          if (navigator.clipboard) navigator.clipboard.writeText(value).then(ok, ok);
          else ok();
        }}
      >
        {done ? 'Copied ✓' : label}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ toasts
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, msg }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className="toast">
            {i.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function StepsLog({ steps, current, failed }: { steps: { key: string; label: string; note?: string }[]; current: string | null; failed?: boolean }) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <ol className="steps-log">
      {steps.map((s, i) => {
        const st = idx === -1 ? 'todo' : i < idx ? 'done' : i === idx ? (failed ? 'fail' : 'active') : 'todo';
        return (
          <li key={s.key} className={st}>
            <span className="ico">{st === 'active' && <Spinner size={16} />}</span>
            <span>
              {s.label}
              {s.note && st === 'active' && <span className="small muted" style={{ display: 'block' }}>{s.note}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
