import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign In — FitWhite Aesthetics',
  description: 'Sign in to the FitWhite Aesthetics POS & Clinic Management System',
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-surface-0 to-brand-100 p-4">
      {/* Subtle decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-brand-200/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] bg-brand-100/30 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg mb-4">
            <span className="text-2xl font-bold text-white font-display">FW</span>
          </div>
          <h1 className="text-2xl font-display font-semibold text-brand-900">
            FitWhite Aesthetics
          </h1>
          <p className="text-sm text-brand-600 mt-1">
            Clinic Management System
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-card border border-brand-100/50 p-8">
          <h2 className="text-lg font-semibold text-brand-900 mb-6">Sign in to your account</h2>
          <LoginForm />
        </div>

        <p className="text-center text-xs text-brand-400 mt-6">
          © 2026 FitWhite Aesthetics. All rights reserved.
        </p>
      </div>
    </div>
  );
}
