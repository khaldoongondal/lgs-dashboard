/**
 * POST /api/events — receives events from the browser pixel.
 *
 * Stores a page_view_events row (and forwards a ViewContent to Meta CAPI
 * when the pixel is configured). Idempotent on event_id.
 */

import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';
import { sendCapiEvent } from '@/lib/meta-capi';
import { buildFbc } from '@/lib/hash';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_EVENTS = new Set(['PageView', 'ContentView', 'AddToCart', 'InitiateCheckout']);

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const {
    event_id, event_name = 'PageView', event_time,
    page_url, referrer,
    fingerprint, fbclid, fbp, fbc: rawFbc,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    user_agent,
  } = body ?? {};

  if (!event_id) {
    return NextResponse.json({ error: 'event_id is required' }, { status: 400 });
  }
  if (!ALLOWED_EVENTS.has(event_name)) {
    return NextResponse.json({ error: `unknown event_name: ${event_name}` }, { status: 400 });
  }

  const clientIp = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
  const ua = user_agent || req.headers.get('user-agent') || null;
  const eventTimeMs = event_time ? Number(event_time) * 1000 : Date.now();
  const fbc = rawFbc || buildFbc(fbclid, eventTimeMs);

  try {
    const sb = serviceClient();

    const insert = await sb.from('page_view_events').upsert(
      [{
        event_id,
        event_name,
        event_time:  new Date(eventTimeMs).toISOString(),
        page_url,
        referrer,
        fingerprint,
        fbclid,
        fbp,
        fbc,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        client_ip: clientIp,
        user_agent: ua,
      }],
      { onConflict: 'event_id', ignoreDuplicates: true }
    ).select('id');

    if (insert.error) {
      console.error('[events] insert error:', insert.error.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    // Fire-and-forget CAPI ViewContent
    sendCapiEvent({
      eventName:      'PageView',
      eventId:        event_id,
      eventTimeUnix:  Math.floor(eventTimeMs / 1000),
      eventSourceUrl: page_url,
      user: {
        clientIp:    clientIp ?? undefined,
        userAgent:   ua ?? undefined,
        fbc:         fbc ?? undefined,
        fbp:         fbp ?? undefined,
        externalId:  fingerprint ?? undefined,
      },
      source: 'pixel',
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[events] handler error:', message);
    return NextResponse.json({ error: 'server_error', detail: message }, { status: 500 });
  }
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
