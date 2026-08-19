import { NextResponse } from 'next/server';
import { fetchPublicScores } from '@/lib/scores';

/**
 * Always read through the shared 10-minute score cache rather than adding a
 * second HTTP cache on top: an independent route cache drifts out of phase with
 * the cache `/bubbles` reads, and the two surfaces then publish different scores
 * for the same moment.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const scores = await fetchPublicScores();
  // The scores carry the time they were actually computed. Stamping "now" here
  // would date a cached fan-out to the moment it was requested.
  const generatedAt = scores.reduce<string>(
    (latest, s) => (s.generatedAt > latest ? s.generatedAt : latest),
    scores[0]?.generatedAt ?? new Date().toISOString(),
  );
  return NextResponse.json({
    generated_at: generatedAt,
    scores,
  });
}
