import { NextResponse } from 'next/server';
import { getScoreHistory } from '@/lib/db';

export const revalidate = 300;

/** Daily POD Score trace for one asset. Empty until the daily cron accrues data. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const asset = symbol.toUpperCase();
  const points = await getScoreHistory(asset, 30);
  return NextResponse.json({ asset, points });
}
