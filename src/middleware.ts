import { updateSession } from '@/lib/supabase/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Maintenance Mode ────────────────────────────────────────────────────────
// Set MAINTENANCE_MODE=true in your Vercel environment variables to enable.
// This is a SERVER-SIDE env var (no NEXT_PUBLIC_ prefix), so Vercel applies it
// immediately on the next request — no rebuild required.
// To disable: set MAINTENANCE_MODE=false (or delete the variable) in Vercel.
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const MAINTENANCE_PATH = '/maintenance';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow the maintenance page itself to always load (avoid redirect loop).
  // Also allow _next assets and API routes to pass through.
  const isMaintenancePage = pathname === MAINTENANCE_PATH;
  const isApiRoute        = pathname.startsWith('/api/');

  if (MAINTENANCE_MODE && !isMaintenancePage && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = MAINTENANCE_PATH;
    return NextResponse.redirect(url);
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
