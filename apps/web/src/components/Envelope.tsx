// The red envelope itself, drawn in CSS so it can open. Colours follow the envelope's theme
// (the seals use the same four themes); "lunar" is the blue dragon house style.
import type { CSSProperties, ReactNode } from 'react';
import type { Theme } from '@hongbao/shared';

export const THEMES: Record<Theme, { label: string; from: string; mid: string; to: string; flap: string; seal: [string, string, string]; sealInk: string; glow: string; slipInk: string }> = {
  lunar: { label: 'Blue dragon', from: '#0066ff', mid: '#003f9e', to: '#001b3d', flap: '#003f9e', seal: ['#00e0ff', '#00a3ff', '#0066ff'], sealInk: '#07080c', glow: 'rgba(0, 140, 255, 0.65)', slipInk: '#0050e0' },
  'classic-red': { label: 'Classic red', from: '#ff2d3f', mid: '#b5001b', to: '#4a0008', flap: '#c4001e', seal: ['#ffe9a3', '#ffc93d', '#d99a00'], sealInk: '#5a0008', glow: 'rgba(255, 45, 70, 0.55)', slipInk: '#b5001b' },
  gold: { label: 'Gold', from: '#ffd666', mid: '#c98a00', to: '#4d3300', flap: '#d99a00', seal: ['#ff6b6b', '#e0182d', '#8a0010'], sealInk: '#fff4d6', glow: 'rgba(255, 200, 60, 0.5)', slipInk: '#8a5a00' },
  christmas: { label: 'Christmas', from: '#18b25a', mid: '#0a6b34', to: '#032914', flap: '#0b7a3a', seal: ['#ff8080', '#e0182d', '#8a0010'], sealInk: '#ffffff', glow: 'rgba(40, 220, 120, 0.45)', slipInk: '#0a6b34' },
};

export function Envelope({
  theme = 'lunar',
  open = false,
  size = 220,
  label,
  sealText = 'OPEN',
  onOpen,
  disabled,
  slip,
  shake,
  inline,
}: {
  theme?: Theme;
  open?: boolean;
  size?: number;
  label?: ReactNode;
  sealText?: string;
  onOpen?: () => void;
  disabled?: boolean;
  /** Shown on the slip that rises out once opened. */
  slip?: ReactNode;
  shake?: boolean;
  /** Render as a <span> (e.g. inside a button). */
  inline?: boolean;
}) {
  const t = THEMES[theme] ?? THEMES.lunar;
  const style = {
    '--env-w': `${size}px`,
    '--env-from': t.from,
    '--env-mid': t.mid,
    '--env-to': t.to,
    '--env-flap': t.flap,
    '--seal-a': t.seal[0],
    '--seal-b': t.seal[1],
    '--seal-c': t.seal[2],
    '--seal-ink': t.sealInk,
    '--env-glow': t.glow,
    '--slip-ink': t.slipInk,
  } as CSSProperties;
  const Tag = onOpen ? 'button' : inline ? 'span' : 'div';
  return (
    <Tag
      className={`env ${open ? 'is-open' : ''} ${onOpen && !open ? 'is-clickable' : ''} ${shake ? 'is-shaking' : ''}`}
      style={style}
      {...(onOpen && { type: 'button' as const, onClick: onOpen, disabled: disabled || open, 'aria-label': 'Open the red envelope' })}
    >
      <span className="env-back" aria-hidden="true" />
      <span className="env-slip" aria-hidden={!open}>
        {slip}
      </span>
      <span className="env-front" aria-hidden="true">
        <span className="env-pattern" />
      </span>
      <span className="env-flap" aria-hidden="true" />
      <span className="env-seal" aria-hidden="true">
        {sealText}
      </span>
      {label && <span className="env-label">{label}</span>}
    </Tag>
  );
}
