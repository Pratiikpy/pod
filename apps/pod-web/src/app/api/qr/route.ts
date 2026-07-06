import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

/**
 * QR code (SVG) for any text — defaults to the POD Telegram bot. Used on the
 * connect page and shareable so a phone can scan straight into the bot. (F49.)
 *   /api/qr?text=https://t.me/podttest_bot
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const text = url.searchParams.get('text') || 'https://t.me/podttest_bot';
  const svg = await QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    color: { dark: '#e6edf3', light: '#0d1117' },
    width: 240,
  });
  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' },
  });
}
