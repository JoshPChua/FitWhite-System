'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="animate-slide-up bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-brand-800 mb-1.5">
          Email
        </label>
        <input
          id="email"
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin"
          required
          autoComplete="username"
          className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                     focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400
                     transition-all duration-200"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-brand-800 mb-1.5">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          autoComplete="current-password"
          className="w-full px-4 py-2.5 rounded-xl border border-brand-200 bg-surface-50 text-brand-900 placeholder:text-brand-300
                     focus:outline-none focus:ring-2 focus:ring-brand-400/50 focus:border-brand-400
                     transition-all duration-200"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-white font-medium
                   hover:from-brand-700 hover:to-brand-800 active:scale-[0.98]
                   disabled:opacity-60 disabled:cursor-not-allowed
                   transition-all duration-200 shadow-sm hover:shadow-md"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Signing in...
          </span>
        ) : (
          'Sign In'
        )}
      </button>
    </form>
  );
}
