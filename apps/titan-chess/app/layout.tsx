import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeBoot } from './components/ThemeBoot';
import { Web3Provider } from './lib/web3';

export const metadata: Metadata = {
  title: 'Titan Chess — Decentralized Chess on Avalanche L1',
  description: 'Play chess and earn TITAN tokens on a custom Avalanche subnet.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f0f11',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="gold">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
        <Web3Provider>
          <ThemeBoot />
          {children}
        </Web3Provider>
      </body>
    </html>
  );
}
