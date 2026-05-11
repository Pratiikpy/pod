import { fetchAllBubbleData } from '@/lib/bubble-data';
import { BubblesClient } from './BubblesClient';

export const dynamic = 'force-dynamic';

export default async function BubblesPage() {
  const bubbles = await fetchAllBubbleData();
  return <BubblesClient bubbles={bubbles} />;
}
