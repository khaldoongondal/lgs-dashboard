/**
 * POST /api/events — receives events from the browser pixel.
 *
 * Accepts five event types:
 *   PageView    — any funnel page load (also fires Meta CAPI ViewContent)
 *   CTAClick    — VSL call-to-action button click
 *   OptIn       — form submit confirmed client-side
 *   Booking     — booking-confirmed signal from the thank-you page
 *   ContentView — generic
 *
 * Stores rows into page_view_events keyed on event_id (idempotent). CTA / OptIn
 * / Booking events do NOT fire Meta CAPI — those are authoritative through GHL
 * webhooks, which run with hashed PII for max EMQ. Pixel-side events are for
 * funnel-conversion analytics only.
 *
 * Persists: UA-parsed device/browser/os, Vercel geo (country/region/city),
 * screen_res from payload, and page_slug (vsl | optin | booking | thankyou).
 */

import { NextResponse } from 'next/server';
import { UAParser } from 'ua-parser-js';
import { serviceClient } from '@/lib/supabase/server';
import { sendCapiEvent } from '@/lib/meta-capi';
import { buildFbc } from '@/lib/hash';
import { corsPreflight, withCors } from '@/lib/cors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_EVENTS = new Set([
  'PageView', 'ContentView',
  'CTAClick', 'OptIn', 'Booking',
  'AddToCart', 'InitiateCheckout',
]);

// Only these fire Meta CAPI ViewContent. Funnel-internal events (CTA/OptIn/
// Booking) stay client-side; GHL webhooks are authoritative for Lead/Schedule
// and run with hashed PII (much higher EMQ than what a browser can send).
const CAPI_EVENTS = new Set(['PageView', 'ContentView']);

interface UaSignals {
  device_type: string | null;
  browser:     string | null;
  os:          string | null;
}

function parseUa(ua: string | null): UaSignals {
  if (!ua) return { device_type: null, browser: null, os: null };
  try {
    const r = new UAParser(ua).getResult();
    return {
      device_type: r.device.type || 'desktop',
      browser:     r.browser.name || null,
      os:          r.os.name || null,
    };
  } catch {
    return { device_type: null, browser: null, os: null };
  }
}

interface Geo { country: string | null; region: string | null; city: string | null }

function readGeo(req: Request): Geo {
  const h = req.headers;
  const country = h.get('x-vercel-ip-country') || null;
  const region  = h.get('x-vercel-ip-country-region') || null;
  const cityRaw = h.get('x-vercel-ip-city');
  let city: string | null = null;
  if (cityRaw) {
    try { city = decodeURIComponent(cityRaw); } catch { city = cityRaw; }
  }
  return { country, region, city };
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return withCors(req, NextResponse.json({ error: 'invalid_json' }, { status: 400 }));
  }

  const {
    event_id, event_name = 'PageView', event_time,
    page_url, page_slug, referrer,
    fingerprint, fbclid, fbp, fbc: rawFbc,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    utm_adset, utm_adid, utm_adsetid, utm_campaignid,
    user_agent, screen_res,
  } = body ?? {};

  if (!event_id) {
    return withCors(req, NextResponse.json({ error: 'event_id is required' }, { status: 400 }));
  }
  if (!ALLOWED_EVENTS.has(event_name)) {
    return withCors(req, NextResponse.json({ error: `unknown event_name: ${event_name}` }, { status: 400 }));
  }

  const clientIp = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
  const ua = user_agent || req.headers.get('user-agent') || null;
  const eventTimeMs = event_time ? Number(event_time) * 1000 : Date.now();
  const fbc = rawFbc || buildFbc(fbclid, eventTimeMs);

  const uaSignals = parseUa(ua);
  const geo       = readGeo(req);

  try {
    const sb = serviceClient();

    const insert = await sb.from('page_view_events').upsert(
      [{
        event_id,
        event_name,
        event_time:  new Date(eventTimeMs).toISOString(),
        page_url,
        page_slug:   page_slug ?? null,
        referrer,
        fingerprint,
        fbclid,
        fbp,
        fbc,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        utm_adset, utm_adid, utm_adsetid, utm_campaignid,
        client_ip: clientIp,
        user_agent: ua,
        device_type: uaSignals.device_type,
        browser:     uaSignals.browser,
        os:          uaSignals.os,
        screen_res:  screen_res ?? null,
        country:     geo.country,
        region:      geo.region,
        city:        geo.city,
      }],
      { onConflict: 'event_id', ignoreDuplicates: true }
    ).select('id');

    if (insert.error) {
      console.error('[events] insert error:', insert.error.message);
      return withCors(req, NextResponse.json({ error: 'db_error' }, { status: 500 }));
    }

    // Fire Meta CAPI ViewContent for page-views only (skip funnel-internal events)
    if (CAPI_EVENTS.has(event_name)) {
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
          country:     geo.country ?? undefined,
          city:        geo.city ?? undefined,
          state:       geo.region ?? undefined,
        },
        source: 'pixel',
      }).catch(() => {});
    }

    return withCors(req, NextResponse.json({ ok: true }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[events] handler error:', message);
    return withCors(req, NextResponse.json({ error: 'server_error', detail: message }, { status: 500 }));
  }
}

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}
