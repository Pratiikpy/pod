import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'POD — your one-person on-chain finance business',
  description:
    'POD turns SoSoValue institutional ETF flow data into AI-narrated trading signals and onchain execution via SoDEX. Run a one-person finance business from your group chat.',
  openGraph: {
    title: 'POD — your one-person on-chain finance business',
    description:
      'AI-narrated trading signals from real Wall Street ETF flow data. Onchain execution via SoDEX. Built on SoSoValue.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
