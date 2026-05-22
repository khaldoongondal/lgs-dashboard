/**
 * GET /api/export?table=<name>&from=<iso>&to=<iso>
 *
 * Generic CSV export. Whitelists tables to prevent arbitrary queries and
 * applies the standard date filter on whichever column makes sense for that
 * table.
 *
 * Response: text/csv with a Content-Disposition that gives the file a
 * meaningful name including the date range.
 */
import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface TableSpec {
  table:      string;
  dateColumn: string | null;       // null = no date filter applied
}

const TABLES: Record<string, TableSpec> = {
  leads:           { table: 'ghl_contacts',         dateColumn: 'created_at' },
  pipeline:        { table: 'ghl_pipeline_events',  dateColumn: 'event_time' },
  pageviews:       { table: 'page_view_events',     dateColumn: 'event_time' },
  capi:            { table: 'capi_event_log',       dateColumn: 'event_time' },
  meta_spend:      { table: 'meta_ad_performance',  dateColumn: 'date' },
  sales:           { table: 'sales_metrics',        dateColumn: 'date' },
  clients:         { table: 'clients',              dateColumn: null },
  funnel_events:   { table: 'funnel_events',        dateColumn: 'date' },
  monthly_kpis:    { table: 'monthly_kpi_snapshots',dateColumn: 'month' },
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return csvEscape(JSON.stringify(v));
  const s = String(v);
  // Quote if contains comma, quote, newline, or leading whitespace.
  if (/[,"\n\r]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => { Object.keys(r).forEach((k) => acc.add(k)); return acc; }, new Set()),
  );
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
  ];
  return lines.join('\r\n');
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const table = url.searchParams.get('table') || '';
  const from  = url.searchParams.get('from')  || '';
  const to    = url.searchParams.get('to')    || '';

  const spec = TABLES[table];
  if (!spec) {
    return NextResponse.json(
      { error: 'unknown_table', allowed: Object.keys(TABLES) },
      { status: 400 },
    );
  }

  const sb = serviceClient();
  let query = sb.from(spec.table).select('*').limit(10000);

  if (spec.dateColumn && from && to) {
    // Day-level columns get ISO date; timestamp columns get the full window.
    const isDayCol = ['date', 'month'].includes(spec.dateColumn);
    const toEnd = isDayCol ? to : `${to}T23:59:59.999Z`;
    query = query.gte(spec.dateColumn, from).lte(spec.dateColumn, toEnd);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }

  const csv = toCsv((data ?? []) as Record<string, unknown>[]);
  const filename = `lgs-${table}${from ? `_${from}_to_${to}` : ''}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
    },
  });
}
