import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/providers/auth-provider';

export const metadata: Metadata = {
  title: 'FitWhite Aesthetics — Clinic Management System',
  description: 'Multi-branch POS and Clinic Management System for FitWhite Aesthetics',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
