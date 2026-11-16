// Theme palettes shared by link-preview cards and stamps (spec §9: classic-red, gold, christmas, lunar).
// The frontend session styles to match these values.
import type { Theme } from '@hongbao/shared';

export interface Palette {
  bgFrom: string;
  bgTo: string;
  envelope: string;
  envelopeShade: string;
  flap: string;
  seal: string;
  sealText: string;
  text: string;
  subtext: string;
  accent: string;
  chipBg: string;
  chipText: string;
  /** Decorative extra drawn on the background. */
  decor: 'coins' | 'sparkle' | 'snow' | 'lanterns';
  label: string;
}

export const PALETTES: Record<Theme, Palette> = {
  'classic-red': {
    bgFrom: '#C62828', bgTo: '#7F0000', envelope: '#E53935', envelopeShade: '#B71C1C', flap: '#D32F2F',
    seal: '#FFC107', sealText: '#7F0000', text: '#FFF8E1', subtext: '#FFD54F', accent: '#FFC107',
    chipBg: '#FFC107', chipText: '#7F0000', decor: 'coins', label: 'classic red',
  },
  gold: {
    bgFrom: '#FFD54F', bgTo: '#F57F17', envelope: '#C62828', envelopeShade: '#8E0000', flap: '#B71C1C',
    seal: '#FFF3C4', sealText: '#8E0000', text: '#3E1F00', subtext: '#6D3A00', accent: '#8E0000',
    chipBg: '#8E0000', chipText: '#FFF3C4', decor: 'sparkle', label: 'gold',
  },
  christmas: {
    bgFrom: '#2E7D32', bgTo: '#0B3D0B', envelope: '#D32F2F', envelopeShade: '#9A0007', flap: '#C62828',
    seal: '#FFFFFF', sealText: '#1B5E20', text: '#FFFFFF', subtext: '#C8E6C9', accent: '#FFCDD2',
    chipBg: '#FFFFFF', chipText: '#1B5E20', decor: 'snow', label: 'Christmas',
  },
  lunar: {
    bgFrom: '#5D0000', bgTo: '#1A0000', envelope: '#D50000', envelopeShade: '#9B0000', flap: '#C51162',
    seal: '#FFD700', sealText: '#5D0000', text: '#FFE082', subtext: '#FFCA28', accent: '#FFD700',
    chipBg: '#FFD700', chipText: '#5D0000', decor: 'lanterns', label: 'Lunar New Year',
  },
};

export const paletteOf = (theme: string): Palette => PALETTES[(theme as Theme)] ?? PALETTES['classic-red'];
