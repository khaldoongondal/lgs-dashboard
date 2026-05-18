/**
 * Supabase server-side clients.
 *
 *  - serviceClient(): bypasses RLS, use for Server Components / API routes
 *    that need full read/write. Never expose service role key to browser.
 *  - anonClient(): public anon key, used when we want RLS enforced (later).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from './types';

type Client = SupabaseClient<Database>;

let _service: Client | null = null;
let _anon:    Client | null = null;

export function serviceClient(): Client {
  if (_service) return _service;
  _service = createClient<Database>(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'lgs-dashboard/server' } },
  });
  return _service;
}

export function anonClient(): Client {
  if (_anon) return _anon;
  _anon = createClient<Database>(env.supabaseUrl(), env.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _anon;
}

/** Convenience: returns null if Supabase isn't configured, so pages can render a friendly empty state in dev. */
export function maybeServiceClient(): Client | null {
  try {
    return serviceClient();
  } catch {
    return null;
  }
}
