/**
 * POST /api/webhooks/ghl — receives outbound webhooks from GHL workflows.
 *
 * Four event types correspond to the 4 CAPI events we want to send to Meta:
 *   Lead              → /api/webhooks/ghl?type=lead
 *   AppointmentBooked → /api/webhooks/ghl?type=booked
 *   AppointmentShown  → /api/webhooks/ghl?type=shown
 *   Purchase          → /api/webhooks/ghl?type=purchase
 *
 * Auth: optional HMAC verification using GHL_WEBHOOK_SECRET. GHL signs
 * outbound webhooks via X-GHL-Signature header. If the secret is unset
 * (dev), we accept all requests and log a warning.
 */

import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';
import { sendCapiEvent, type InternalEvent } from '@/lib/meta-capi';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TYPE_MAP: Record<string, InternalEvent> = {
  lead:     'Lead',
  booked:   'AppointmentBooked',
  shown:    'AppointmentShown',
  purchase: 'Purchase',
};

async function hmacHexSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get('type') || '';
  const eventName = TYPE_MAP[type.toLowerCase()];
  if (!eventName) {
    return NextResponse.json(
      { error: 'unknown type — use ?type=lead|booked|shown|purchase' },
      { status: 400 }
    );
  }

  // Read body once as text so we can both verify HMAC and parse JSON.
  const raw = await req.text();

  const secret = env.ghlWebhookSecret();
  if (secret) {
    const provided =
      req.headers.get('x-ghl-signature') ||
      req.headers.get('x-webhook-signature') || '';
    const expected = await hmacHexSha256(secret, raw);
    // Tolerate base64-prefixed schemes etc by accepting either case-insensitive equal or prefix-trimmed equal
    const ok = provided.replace(/^sha256=/i, '').toLowerCase() === expected.toLowerCase();
    if (!ok) {
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }
  } else if (env.isProd()) {
    console.warn('[ghl-webhook] GHL_WEBHOOK_SECRET not set — accepting unsigned webhook in production');
  }

  let payload: any;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  // GHL payloads vary by workflow setup. We try a few common shapes.
  const contactId =
    payload.contact?.id ||
    payload.contact_id ||
    payload.id ||
    null;

  if (!contactId) {
    return NextResponse.json({ error: 'no_contact_id_in_payload' }, { status: 400 });
  }

  const email     = payload.contact?.email     ?? payload.email     ?? null;
  const firstName = payload.contact?.firstName ?? payload.first_name ?? null;
  const lastName  = payload.contact?.lastName  ?? payload.last_name  ?? null;
  const phone     = payload.contact?.phone     ?? payload.phone     ?? null;
  const tags      = payload.contact?.tags      ?? payload.tags      ?? [];

  // Custom fields where we expect the UTMs to live
  const cf = payload.customFields ?? payload.contact?.customFields ?? {};
  const utm = {
    utm_source:   cf.utm_source   ?? payload.utm_source   ?? null,
    utm_medium:   cf.utm_medium   ?? payload.utm_medium   ?? null,
    utm_campaign: cf.utm_campaign ?? payload.utm_campaign ?? null,
    utm_content:  cf.utm_content  ?? payload.utm_content  ?? null,
    utm_term:     cf.utm_term     ?? payload.utm_term     ?? null,
  };
  const fbclid      = cf.fbclid      ?? payload.fbclid      ?? null;
  const fingerprint = cf.fingerprint ?? payload.fingerprint ?? null;

  // Appointment / opportunity data
  const appointment = payload.appointment ?? null;
  const opportunity = payload.opportunity ?? null;
  const repId    = appointment?.userId ?? opportunity?.assignedTo ?? payload.user?.id    ?? null;
  const repName  =
    [appointment?.user?.firstName, appointment?.user?.lastName].filter(Boolean).join(' ').trim() ||
    payload.user?.name || null;
  const repEmail = appointment?.user?.email ?? payload.user?.email ?? null;
  const dealValue = Number(opportunity?.monetaryValue ?? payload.deal_value ?? payload.amount ?? 0) || 0;
  const eventTime = new Date(
    appointment?.startTime || opportunity?.dateCreated || payload.created_at || Date.now()
  ).toISOString();

  const sb = serviceClient();

  // Upsert contact
  const contactUpsert = await sb
    .from('ghl_contacts')
    .upsert(
      [{
        ghl_contact_id: String(contactId),
        email,
        first_name: firstName,
        last_name:  lastName,
        phone,
        ...utm,
        fbclid,
        fingerprint,
        tags,
        raw_payload: payload,
        updated_at: new Date().toISOString(),
        opted_in_at: eventName === 'Lead' ? eventTime : undefined,
      }],
      { onConflict: 'ghl_contact_id' }
    )
    .select('id')
    .single();

  if (contactUpsert.error) {
    console.error('[ghl-webhook] contact upsert:', contactUpsert.error.message);
    return NextResponse.json({ error: 'db_error', detail: contactUpsert.error.message }, { status: 500 });
  }
  const contactRowId = contactUpsert.data?.id as number;

  // Insert pipeline event
  const eventId = `ghl_${eventName}_${contactId}_${appointment?.id ?? opportunity?.id ?? Date.parse(eventTime)}`;
  const evIns = await sb
    .from('ghl_pipeline_events')
    .upsert(
      [{
        contact_id:     contactRowId,
        ghl_event_id:   eventId,
        event_name:     eventName,
        event_time:     eventTime,
        rep_id:         repId   ? String(repId) : null,
        rep_name:       repName,
        rep_email:      repEmail,
        pipeline_stage: opportunity?.pipelineStageId ?? payload.pipeline_stage ?? null,
        deal_value:     dealValue,
        currency:       opportunity?.currency ?? 'CAD',
        calendar_id:    appointment?.calendarId ?? null,
        appointment_id: appointment?.id ?? null,
        ...utm,
        raw_payload:    payload,
      }],
      { onConflict: 'ghl_event_id', ignoreDuplicates: true }
    );

  if (evIns.error) {
    console.error('[ghl-webhook] pipeline insert:', evIns.error.message);
    return NextResponse.json({ error: 'db_error', detail: evIns.error.message }, { status: 500 });
  }

  // Forward to Meta CAPI
  const capi = await sendCapiEvent({
    eventName,
    eventId,
    eventTimeUnix: Math.floor(new Date(eventTime).getTime() / 1000),
    eventSourceUrl: payload.source_url ?? undefined,
    user: {
      email, firstName, lastName, phone,
      fbc: cf.fbc ?? payload.fbc ?? undefined,
      fbp: cf.fbp ?? payload.fbp ?? undefined,
      externalId: fingerprint ?? undefined,
    },
    value:    eventName === 'Purchase' ? dealValue : undefined,
    currency: opportunity?.currency ?? 'CAD',
    orderId:  opportunity?.id ?? undefined,
    contactId: contactRowId,
    source:    'ghl_webhook',
  });

  return NextResponse.json({ ok: true, capi_sent: capi.ok });
}
