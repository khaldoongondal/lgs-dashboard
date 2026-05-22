/**
 * GET /api/cron/ga4-funnel — daily pull of per-page funnel metrics from GA4.
 *
 * Aggregates pagePath × date metrics (users, sessions, avg duration, bounce
 * rate), buckets each path into a funnel slug (vsl|optin|booking|thankyou),
 * sums per slug, upserts into funnel_events keyed on (date, page_slug).
 *
 * Auth: CRON_SECRET (Bearer header or ?secret=).
 *
 * Configure:
 *   GA4_PROPERTY_ID         — numeric property ID
 *   GA4_SERVICE_ACCOUNT_KEY — JSON key string (one line, escaped)
 *
 * Until those env vars are set, this endpoint returns 503 ga4_not_configured.
 */
import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { fetchGa4PageMetrics, getGa4AccessToken, pathToSlug } from '@/lib/ga4';

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

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const propertyId = env.ga4PropertyId();
  const sakey      = env.ga4ServiceAccountKey();
  if (!propertyId || !sakey) {
    return NextResponse.json({ error: 'ga4_not_configured' }, { status: 503 });
  }

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get('since');
  const untilParam = url.searchParams.get('until');

  // Default: yesterday only. Range mode for backfills.
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  const startDate = sinceParam || yesterday;
  const endDate   = untilParam || yesterday;

  let accessToken: string;
  try {
    accessToken = await getGa4AccessToken(sakey);
  } catch (err) {
    return NextResponse.json(
      { error: 'ga4_auth_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  let rows;
  try {
    rows = await fetchGa4PageMetrics({ propertyId, accessToken, startDate, endDate });
  } catch (err) {
    return NextResponse.json(
      { error: 'ga4_fetch_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // ── Aggregate page paths → funnel slugs per date ───────────────────
  // Bucket key: `${date}|${slug}`
  interface Bucket {
    date:            string;
    page_slug:       string;
    unique_visitors: number;
    page_views:      number;
    avg_seconds_sum: number;     // weighted by page_views to recover total time
    bounce_sum:      number;     // weighted by users
  }
  const buckets = new Map<string, Bucket>();

  for (const r of rows) {
    const slug = pathToSlug(r.page_path);
    if (slug === 'other') continue;
    const k = `${r.date}|${slug}`;
    let b = buckets.get(k);
    if (!b) {
      b = { date: r.date, page_slug: slug, unique_visitors: 0, page_views: 0, avg_seconds_sum: 0, bounce_sum: 0 };
      buckets.set(k, b);
    }
    b.unique_visitors += r.users;
    b.page_views      += r.page_views;
    b.avg_seconds_sum += (r.avg_seconds * r.page_views);
    b.bounce_sum      += (r.bounce_rate * r.users);
  }

  const upserts = Array.from(buckets.values()).map((b) => ({
    date:            b.date,
    page_slug:       b.page_slug,
    unique_visitors: b.unique_visitors,
    page_views:      b.page_views,
    avg_seconds:     b.page_views > 0 ? b.avg_seconds_sum / b.page_views : null,
    bounce_rate:     b.unique_visitors > 0 ? b.bounce_sum / b.unique_visitors : null,
    computed_at:     new Date().toISOString(),
  }));

  if (upserts.length === 0) {
    return NextResponse.json({ ok: true, written: 0, range: { startDate, endDate } });
  }

  const sb = serviceClient();
  const { error } = await sb
    .from('funnel_events')
    .upsert(upserts, { onConflict: 'date,page_slug' });

  if (error) {
    return NextResponse.json({ error: 'db_write_error', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok:      true,
    written: upserts.length,
    range:   { startDate, endDate },
  });
}
