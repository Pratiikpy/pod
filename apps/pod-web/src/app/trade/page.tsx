import { Suspense } from 'react';
import { POD } from '@/design/tokens';
import { SiteNav } from '@/components/SiteNav';
import { TradeClient } from './TradeClient';

export const metadata = {
  title: 'Trade the POD signal — SoDEX spot and perps',
  description:
    'Connect your own wallet, read the POD Score, and trade on SoDEX in one place. Non-custodial: orders are signed in your browser and go straight to SoDEX.',
};

export default function TradePage() {
  return (
    <div style={{ minHeight: '100vh', background: POD.ink900, color: POD.ink100, fontFamily: 'Geist, system-ui' }}>
      <SiteNav active="/trade" />
      <main style={{ maxWidth: 1040, margin: '0 auto', padding: '40px 24px 96px' }}>
        <Suspense fallback={<p style={{ color: POD.ink400 }}>Loading…</p>}>
          <TradeClient />
        </Suspense>
      </main>
    </div>
  );
}
