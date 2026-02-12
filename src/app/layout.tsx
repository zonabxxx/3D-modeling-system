import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ADSUN 3D Konfigurátor | Navrhni si svetelnú reklamu',
  description: 'Nahraj fotku fasády, zadaj text a okamžite si pozri 3D náhľad svetelnej reklamy. Jednoduchá objednávka 3D písmen na mieru.',
  keywords: ['3D písmená', 'svetelná reklama', 'konfigurátor', 'LED nápis', 'ADSUN'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sk">
      <body className="min-h-screen bg-[#0a0a0a] text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
