import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MediaPulse RHD',
  description: 'Dashboard inicial de control de presupuesto y forecast'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
