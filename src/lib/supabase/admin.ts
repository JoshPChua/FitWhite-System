import { createClient } from '@supabase/supabase-js';

/**
 * Server-side admin client using the service role key.
 * NEVER expose this on the client side.
 * Used for operations that require elevated privileges:
 * - Creating auth users
 * - Deleting auth users
 * - Bypassing RLS for admin operations
 * 
 * Note: We intentionally omit the Database generic here because
 * the admin client is used for operations where TypeScript strict
 * typing conflicts with dynamic update payloads. All type safety
 * is enforced at the application level instead.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
