import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Comanda Pro',
  description: 'Control de comandas y mesas en tiempo real',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Comanda',
  },
};

export const viewport: Viewport = {
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-cyan-500/30">
        {children}
      </body>
    </html>
  );
}

