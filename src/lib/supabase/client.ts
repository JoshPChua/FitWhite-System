import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

/**
 * Cached browser-side Supabase client singleton.
 *
 * createBrowserClient is lightweight but there is no reason to create
 * multiple instances in the same browser tab. Caching one instance avoids
 * redundant object allocation and ensures all components share the same
 * auth listener / realtime connection.
 *
 * IMPORTANT: Do NOT import this module from API routes or server components.
 * Use `@/lib/supabase/server` (per-request) or `@/lib/supabase/admin` instead.
 */
let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  if (!cached) {
    cached = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return cached;
}
