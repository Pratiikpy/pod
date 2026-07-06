import { ImageResponse } from 'next/og';
import { fetchAllBubbleData } from '@/lib/bubble-data';
import { scoreColor } from '@/design/tokens';

export const dynamic = 'force-dynamic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Shareable score card for /asset/[symbol]. Posted to X/Telegram, this branded
 * card renders with the live POD Score — every share is an ad. (F20 / F45.)
 */
export default async function Image({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  const all = await fetchAllBubbleData().catch(() => []);
  const b = all.find((x) => x.asset === sym);
  const score = b?.score ?? 50;
  const dir = (b?.direction ?? 'HOLD').replace('_', ' ');
  const name = b?.name ?? sym;
  const reason = (b?.reasoning ?? 'Live institutional ETF-flow score.').slice(0, 160);
  const color = scoreColor(score);

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: '#070b12',
          padding: '60px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', width: 34, height: 20, borderRadius: 999, background: '#bef264' }} />
          <div style={{ display: 'flex', fontSize: 30, color: '#e6edf3', fontWeight: 700, fontStyle: 'italic' }}>pod</div>
          <div style={{ display: 'flex', fontSize: 20, color: '#6b7683', marginLeft: 8 }}>institutional ETF-flow score</div>
        </div>

        {/* spacer */}
        <div style={{ display: 'flex', flexGrow: 1 }} />

        {/* body */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 48 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: 380 }}>
            <div style={{ display: 'flex', fontSize: 240, fontWeight: 800, lineHeight: 1, color }}>{String(score)}</div>
            <div style={{ display: 'flex', fontSize: 30, color: '#8b95a1', marginTop: 6 }}>{`POD Score · ${dir}`}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, paddingBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <div style={{ display: 'flex', fontSize: 72, fontWeight: 800, color: '#e6edf3' }}>{sym}</div>
              <div style={{ display: 'flex', fontSize: 30, color: '#6b7683' }}>{name}</div>
            </div>
            <div style={{ display: 'flex', fontSize: 27, color: '#c9d1d9', lineHeight: 1.35, marginTop: 14 }}>{reason}</div>
          </div>
        </div>

        {/* spacer */}
        <div style={{ display: 'flex', flexGrow: 1 }} />

        {/* footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: 22, color: '#6b7683' }}>{`pod-app-phi.vercel.app/asset/${sym}`}</div>
          <div style={{ display: 'flex', fontSize: 22, color: '#bef264' }}>@podttest_bot</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
