/**
 * POST /api/events/heartbeat — pixel pings this every ~15s while a tab is
 * visible, sending the cumulative active seconds the visitor has spent on
 * the page. We UPDATE page_view_events.time_on_page (keyed by event_id) to
 * the highest value seen so partial pings + a final beacon converge.
 *
 * Used by the funnel dashboard to compute avg time on page without GA4.
 */
import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const event_id = String(body?.event_id || '');
  const seconds  = Math.max(0, Math.min(7200, Number(body?.time_on_page) || 0));
  if (!event_id) {
    return NextResponse.json({ error: 'event_id_required' }, { status: 400 });
  }

  const sb = serviceClient();
  // Use a small SQL trick: only update if the new value is higher. We don't
  // have a stored procedure, so emulate by fetching first.
  const { data: existing } = await sb
    .from('page_view_events')
    .select('id, time_on_page')
    .eq('event_id', event_id)
    .limit(1);

  const row = existing?.[0] as { id: number; time_on_page: number | null } | undefined;
  if (!row) return NextResponse.json({ ok: false, reason: 'not_found' });

  const current = row.time_on_page ?? 0;
  if (seconds > current) {
    await sb.from('page_view_events').update({ time_on_page: seconds }).eq('id', row.id);
  }
  return NextResponse.json({ ok: true, time_on_page: Math.max(seconds, current) });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age':       '600',
    },
  });
}
