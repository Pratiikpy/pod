// pod-shared.ts — design tokens (mirrors the standalone HTML bundle byte-for-byte)

export const POD = {
  ink1000: '#04060A',
  ink900:  '#07090D',
  ink850:  '#0C0F15',
  ink800:  '#11151D',
  ink700:  '#181D27',
  ink600:  '#232936',
  ink500:  '#364055',
  ink400:  '#5A6479',
  ink300:  '#8993A8',
  ink200:  '#B5BCCB',
  ink100:  '#DBDFE7',
  ink50:   '#F0F2F6',
  bone50:  '#FBF8F1',
  bone100: '#F4EFE3',
  bone200: '#ECE4D2',
  bone300: '#D5C9AF',
  lime:    '#CFFF3D',
  limeSoft: '#B0E830',
  limeDeep: '#7FB614',
  copper:  '#C68A4E',
  copperDeep: '#8B5A28',
  cobalt:  '#2F4FE0',
  cobaltSoft: '#7290F2',
  amber:   '#E8A23A',
  red:     '#D85056',
  blue:    '#5B8DEF',
} as const;

export function scoreColor(s: number): string {
  if (s >= 81) return POD.lime;
  if (s >= 56) return POD.limeSoft;
  if (s >= 31) return POD.amber;
  return POD.red;
}

export function scoreLabel(s: number): string {
  if (s >= 81) return 'Strong conviction';
  if (s >= 56) return 'Constructive';
  if (s >= 31) return 'Mixed';
  return 'Defensive';
}

/** Deterministic sparkline data generator. */
export function genSpark(seed = 1, n = 40): number[] {
  let s = seed;
  const out: number[] = [];
  let v = 50;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    v += (s / 233280 - 0.45) * 8;
    v = Math.max(10, Math.min(90, v));
    out.push(v);
  }
  return out;
}
