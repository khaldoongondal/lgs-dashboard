/**
 * Supabase browser client (anon key).
 * Used only for client components that need direct reads with RLS.
 * Most of the dashboard renders server-side so this is rarely used in v1.
 */

'use client';

import { createBrowserClient } from '@supabase/ssr';

export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
