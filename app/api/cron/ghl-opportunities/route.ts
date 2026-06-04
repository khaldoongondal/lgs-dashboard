/**
 * GET /api/cron/ghl-opportunities — pull GHL pipelines + opportunities into
 * Supabase. Powers the /sales-opportunities dashboard.
 *
 * Auth: CRON_SECRET (Bearer header or ?secret=). Same pattern as the Meta cron.
 * Not in vercel.json by default (Hobby caps crons at 2) — trigger manually, via
 * the dashboard "Refresh from GHL" button, or schedule it once you're on Pro.
 */
import { NextResponse } from 'next/server';
import { syncOpportunities } from '@/lib/ghl-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const fromQuery  = url.searchParams.get('secret');
  const fromHeader = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return fromQuery === secret || fromHeader === secret;
}

export async function GET(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await syncOpportunities();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
