import { fetchAllBubbleData } from '@/lib/bubble-data';
import { scoreColor } from '@/design/tokens';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

/**
 * Embeddable live POD Score badge (SVG). Drop it on a site, README, or X bio:
 *   ![POD BTC](https://pod-app-phi.vercel.app/api/badge/BTC)
 * It auto-updates with the live score. (F46.)
 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  const all = await fetchAllBubbleData().catch(() => []);
  const b = all.find((x) => x.asset === sym);
  const score = b?.score ?? 50;
  const dir = (b?.direction ?? 'HOLD').replace('_', ' ');
  const color = scoreColor(score);

  const left = `POD ${sym}`;
  const right = `${score} · ${dir}`;
  const lw = 34 + left.length * 6.5;
  const rw = 24 + right.length * 6.5;
  const w = lw + rw;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28" role="img" aria-label="${esc(left)}: ${esc(right)}">
  <rect width="${w}" height="28" rx="6" fill="#0d1117"/>
  <rect x="${lw}" width="${rw}" height="28" rx="6" fill="#0d1117"/>
  <rect x="${lw - 6}" width="6" height="28" fill="#0d1117"/>
  <g font-family="Verdana,Geneva,sans-serif" font-size="12">
    <text x="14" y="18" fill="#8b95a1">${esc(left)}</text>
    <text x="${lw + 12}" y="18" fill="${color}" font-weight="bold">${esc(right)}</text>
  </g>
  <circle cx="${w - 12}" cy="14" r="4" fill="${color}"/>
</svg>`;

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  });
}
