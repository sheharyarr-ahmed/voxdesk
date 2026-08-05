import type { Metadata } from 'next';
import { Space_Grotesk, Space_Mono } from 'next/font/google';

import './globals.css';

// The two faces SPEC.md section 8 names. Loaded through next/font so they are self
// hosted from the build output rather than fetched from a third party at runtime,
// which keeps the page off an external request path and out of a cookie banner
// conversation. The variables are consumed by the @theme block in globals.css.
const display = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
});

const mono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-space-mono',
});

export const metadata: Metadata = {
  title: 'VoxDesk',
  description:
    'A browser voice concierge that answers from a controlled knowledge base and books a real discovery call during the conversation.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
