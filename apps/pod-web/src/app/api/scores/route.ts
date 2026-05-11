import { NextResponse } from 'next/server';
import { fetchPublicScores } from '@/lib/scores';

export const revalidate = 600;

export async function GET() {
  const scores = await fetchPublicScores();
  return NextResponse.json({
    generated_at: new Date().toISOString(),
    scores,
  });
}
