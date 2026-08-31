import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Flappy Bird Ultra — voe, atire e compre armas',
  description:
    'Flappy Bird com tiro: voe pelos canos, atire nos inimigos com ESPAÇO, compre armas no meio do voo e entre no ranking Top 10.',
  openGraph: {
    title: 'Flappy Bird Ultra',
    description: 'Voe pelos canos, atire nos inimigos e compre armas — sem pausa. Ranking Top 10.',
    type: 'website',
    locale: 'pt_BR',
  },
};

export const viewport: Viewport = {
  themeColor: '#0b1020',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
