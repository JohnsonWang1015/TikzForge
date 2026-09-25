import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TikzForge · Scientific Diagram IDE',
  description: 'Visual editing for TikZ, PGFPlots and scientific diagrams.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
