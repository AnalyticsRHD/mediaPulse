import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MediaPulse RHD',
  description: 'Dashboard inicial de control de presupuesto y forecast',
  icons: {
    icon: 'https://res.cloudinary.com/dbs8s1acw/image/upload/v1782851989/image-removebg-preview_2_ephya8.png',
    shortcut: 'https://res.cloudinary.com/dbs8s1acw/image/upload/v1782851989/image-removebg-preview_2_ephya8.png',
    apple: 'https://res.cloudinary.com/dbs8s1acw/image/upload/v1782851989/image-removebg-preview_2_ephya8.png'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
