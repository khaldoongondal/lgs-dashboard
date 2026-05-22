/**
 * GET /api/cron/sales-aggregate — daily rep×day rollup.
 *
 * Reads ghl_pipeline_events for the requested date range, groups by
 * (date, rep_id, rep_name, rep_email), counts events by type, and upserts
 * into sales_metrics. Idempotent on (date, rep_id) — safe to re-run.
 *
 * Auth: same CRON_SECRET pattern as the Meta cron.
 *
 * Query params:
 *   - date         single ISO date (defaults to yesterday in UTC)
 *   - since,until  alternative range; capped at 90 days
 *
 * Event mapping:
 *   AppointmentBooked → intro_calls
 *   AppointmentShown  → live_intros
 *   OfferMade         → offers_made
 *   Purchase          → closes (also += deal_value into collected / total_revenue)
 *
 * Rates (Show%, Offer%, Close%, etc.) are NOT pre-stored — they're recomputed
 * at query time so a count correction in this table updates all rates instantly.
 */
import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function* eachDayInclusive(since: string, until: string): Generator<string> {
  const s = new Date(`${since}T00:00:00Z`);
  const u = new Date(`${until}T00:00:00Z`);
  for (let t = s.getTime(); t <= u.getTime(); t += 86_400_000) {
    yield ymd(new Date(t));
  }
}

function authOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const fromQuery  = url.searchParams.get('secret');
  const fromHeader = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return fromQuery === secret || fromHeader === secret;
}

interface Bucket {
  date:               string;
  rep_id:             string;
  rep_name:           string | null;
  rep_email:          string | null;
  intro_calls:        number;
  live_intros:        number;
  offers_made:        number;
  closes:             number;
  collected:          number;   // sum(deal_value) on Purchase events
  total_revenue:      number;   // currently mirrors collected
  deposits:           number;   // placeholder — wire when GHL has a Deposit stage
  verbal_commitments: number;   // placeholder — wire when there's a tracking event
}

function bucketKey(date: string, rep_id: string): string {
  return `${date}|${rep_id}`;
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateParam  = url.searchParams.get('date');
  const sinceParam = url.searchParams.get('since');
  const untilParam = url.searchParams.get('until');

  let dates: string[];
  if (sinceParam && untilParam) {
    dates = Array.from(eachDayInclusive(sinceParam, untilParam));
  } else if (dateParam) {
    dates = [dateParam];
  } else {
    const yesterday = new Date(Date.now() - 86_400_000);
    dates = [ymd(yesterday)];
  }
  if (dates.length > 90) {
    return NextResponse.json({ error: 'range_too_large', max_days: 90 }, { status: 400 });
  }

  const from = dates[0];
  const to   = dates[dates.length - 1];
  const toEnd = `${to}T23:59:59.999Z`;

  const sb = serviceClient();

  const { data, error } = await sb
    .from('ghl_pipeline_events')
    .select('event_name, event_time, rep_id, rep_name, rep_email, deal_value')
    .gte('event_time', from)
    .lte('event_time', toEnd);

  if (error) {
    return NextResponse.json({ error: 'db_read_error', detail: error.message }, { status: 500 });
  }

  // ── Group by (date, rep_id) ──────────────────────────────────────────
  const buckets = new Map<string, Bucket>();
  function ensure(date: string, rep_id: string, rep_name: string | null, rep_email: string | null): Bucket {
    const k = bucketKey(date, rep_id);
    let b = buckets.get(k);
    if (!b) {
      b = {
        date, rep_id,
        rep_name:  rep_name  ?? null,
        rep_email: rep_email ?? null,
        intro_calls: 0, live_intros: 0, offers_made: 0, closes: 0,
        collected: 0, total_revenue: 0,
        deposits: 0, verbal_commitments: 0,
      };
      buckets.set(k, b);
    } else {
      if (!b.rep_name  && rep_name)  b.rep_name  = rep_name;
      if (!b.rep_email && rep_email) b.rep_email = rep_email;
    }
    return b;
  }

  for (const r of data ?? []) {
    const rr = r as any;
    const date = (rr.event_time as string).slice(0, 10);
    if (!dates.includes(date)) continue;

    const rep_id = rr.rep_id || '(unassigned)';
    const b = ensure(date, rep_id, rr.rep_name, rr.rep_email);

    switch (rr.event_name) {
      case 'AppointmentBooked':
        b.intro_calls += 1;
        break;
      case 'AppointmentShown':
        b.live_intros += 1;
        break;
      case 'OfferMade':
        b.offers_made += 1;
        break;
      case 'Purchase': {
        b.closes += 1;
        const v = Number(rr.deal_value) || 0;
        b.collected     += v;
        b.total_revenue += v;
        break;
      }
    }
  }

  if (buckets.size === 0) {
    return NextResponse.json({ ok: true, dates: dates.length, rows: 0, written: 0 });
  }

  // ── Upsert into sales_metrics ────────────────────────────────────────
  const rows = Array.from(buckets.values()).map((b) => ({
    date:               b.date,
    rep_id:             b.rep_id,
    rep_name:           b.rep_name,
    rep_email:          b.rep_email,
    intro_calls:        b.intro_calls,
    live_intros:        b.live_intros,
    offers_made:        b.offers_made,
    closes:             b.closes,
    collected:          b.collected,
    total_revenue:      b.total_revenue,
    deposits:           b.deposits,
    verbal_commitments: b.verbal_commitments,
    recomputed_at:      new Date().toISOString(),
  }));

  const upsert = await sb
    .from('sales_metrics')
    .upsert(rows, { onConflict: 'date,rep_id' });

  if (upsert.error) {
    return NextResponse.json({ error: 'db_write_error', detail: upsert.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok:      true,
    dates:   dates.length,
    rows:    rows.length,
    written: rows.length,
    range:   { from, to },
  });
}
