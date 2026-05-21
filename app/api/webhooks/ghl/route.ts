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
 *
 * Identity resolution: spec step 8 — when a contact submits, try three signals
 * to connect them back to an anonymous page-view session, in priority order:
 *   1. fbclid       (deterministic; wins unconditionally if present)
 *   2. fingerprint  (probabilistic; ~90% — ThumbmarkJS)
 *   3. email        (identity-based; reused only if the contact had prior page views)
 * On match, we backfill page_view_events.contact_id and inherit fbc/fbp/IP/UA/geo
 * from the matched session so the CAPI event has maximum EMQ.
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

/** Subset of page_view_events fields we inherit into the contact + CAPI send. */
type SessionRow = {
  id: number;
  fingerprint: string | null;
  fbc:         string | null;
  fbp:         string | null;
  client_ip:   string | null;
  user_agent:  string | null;
  country:     string | null;
  region:      string | null;
  city:        string | null;
  utm_source:   string | null;
  utm_medium:   string | null;
  utm_campaign: string | null;
  utm_content:  string | null;
  utm_term:     string | null;
};

const SESSION_FIELDS =
  'id,fingerprint,fbc,fbp,client_ip,user_agent,country,region,city,' +
  'utm_source,utm_medium,utm_campaign,utm_content,utm_term';

type ResolutionTier = 'fbclid' | 'fingerprint' | 'email' | null;

/**
 * 3-tier cascade. Returns the most recent page view that matches the strongest
 * signal available, plus a label for which tier resolved it.
 */
async function resolveAnonymousSession(
  sb: ReturnType<typeof serviceClient>,
  signals: { fbclid?: string | null; fingerprint?: string | null; email?: string | null },
): Promise<{ tier: ResolutionTier; row: SessionRow | null }> {
  // ── Tier 1: fbclid (deterministic) ───────────────────────────────────
  if (signals.fbclid) {
    const { data } = await sb
      .from('page_view_events')
      .select(SESSION_FIELDS)
      .eq('fbclid', signals.fbclid)
      .order('event_time', { ascending: false })
      .limit(1);
    if (data && data.length > 0) return { tier: 'fbclid', row: data[0] as unknown as SessionRow };
  }

  // ── Tier 2: fingerprint (ThumbmarkJS) ────────────────────────────────
  if (signals.fingerprint) {
    const { data } = await sb
      .from('page_view_events')
      .select(SESSION_FIELDS)
      .eq('fingerprint', signals.fingerprint)
      .order('event_time', { ascending: false })
      .limit(1);
    if (data && data.length > 0) return { tier: 'fingerprint', row: data[0] as unknown as SessionRow };
  }

  // ── Tier 3: email (look up via an existing contact's prior page views) ─
  if (signals.email) {
    const { data: existing } = await sb
      .from('ghl_contacts')
      .select('id')
      .eq('email', signals.email)
      .limit(1);
    if (existing && existing.length > 0) {
      const priorContactId = (existing[0] as { id: number }).id;
      const { data: pv } = await sb
        .from('page_view_events')
        .select(SESSION_FIELDS)
        .eq('contact_id', priorContactId)
        .order('event_time', { ascending: false })
        .limit(1);
      if (pv && pv.length > 0) return { tier: 'email', row: pv[0] as unknown as SessionRow };
    }
  }

  return { tier: null, row: null };
}

/** Backfill page_view_events.contact_id for any rows matching this contact's signals. */
async function backfillPageViews(
  sb: ReturnType<typeof serviceClient>,
  contactRowId: number,
  signals: { fbclid?: string | null; fingerprint?: string | null },
): Promise<void> {
  const updates: Promise<unknown>[] = [];
  if (signals.fbclid) {
    updates.push(
      Promise.resolve(
        sb.from('page_view_events')
          .update({ contact_id: contactRowId })
          .eq('fbclid', signals.fbclid)
          .is('contact_id', null),
      ),
    );
  }
  if (signals.fingerprint) {
    updates.push(
      Promise.resolve(
        sb.from('page_view_events')
          .update({ contact_id: contactRowId })
          .eq('fingerprint', signals.fingerprint)
          .is('contact_id', null),
      ),
    );
  }
  await Promise.all(updates);
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

  // Custom fields where we expect the UTMs / fbclid / fingerprint to live
  const cf = payload.customFields ?? payload.contact?.customFields ?? {};
  const formUtms = {
    utm_source:   cf.utm_source   ?? payload.utm_source   ?? null,
    utm_medium:   cf.utm_medium   ?? payload.utm_medium   ?? null,
    utm_campaign: cf.utm_campaign ?? payload.utm_campaign ?? null,
    utm_content:  cf.utm_content  ?? payload.utm_content  ?? null,
    utm_term:     cf.utm_term     ?? payload.utm_term     ?? null,
  };
  const formFbclid      = cf.fbclid      ?? payload.fbclid      ?? null;
  const formFingerprint = cf.fingerprint ?? payload.fingerprint ?? null;

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

  // ── Identity Resolution Cascade ──────────────────────────────────────
  // Look up a prior anonymous page-view session this contact may have had.
  // Whichever tier wins, we inherit its fbc/fbp/IP/UA/geo into the CAPI send
  // and (where the form didn't supply them) into the contact record itself.
  const session = await resolveAnonymousSession(sb, {
    fbclid:      formFbclid,
    fingerprint: formFingerprint,
    email,
  });

  // Merge UTMs: form values win when present, else inherit from session.
  const utm = {
    utm_source:   formUtms.utm_source   ?? session.row?.utm_source   ?? null,
    utm_medium:   formUtms.utm_medium   ?? session.row?.utm_medium   ?? null,
    utm_campaign: formUtms.utm_campaign ?? session.row?.utm_campaign ?? null,
    utm_content:  formUtms.utm_content  ?? session.row?.utm_content  ?? null,
    utm_term:     formUtms.utm_term     ?? session.row?.utm_term     ?? null,
  };
  const resolvedFingerprint = formFingerprint ?? session.row?.fingerprint ?? null;
  const resolvedFbc         = cf.fbc ?? payload.fbc ?? session.row?.fbc ?? null;
  const resolvedFbp         = cf.fbp ?? payload.fbp ?? session.row?.fbp ?? null;
  const resolvedIp          = session.row?.client_ip   ?? null;
  const resolvedUa          = session.row?.user_agent  ?? null;
  const resolvedCity        = session.row?.city        ?? null;
  const resolvedRegion      = session.row?.region      ?? null;
  const resolvedCountry     = session.row?.country     ?? null;

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
        fbclid:      formFbclid,
        fingerprint: resolvedFingerprint,
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

  // Backfill any anonymous page_view_events rows whose fbclid/fingerprint
  // matches this contact — links the historical session to the now-known person.
  await backfillPageViews(sb, contactRowId, {
    fbclid:      formFbclid,
    fingerprint: resolvedFingerprint,
  });

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

  // Forward to Meta CAPI — pull in every signal we have for max EMQ.
  const capi = await sendCapiEvent({
    eventName,
    eventId,
    eventTimeUnix: Math.floor(new Date(eventTime).getTime() / 1000),
    eventSourceUrl: payload.source_url ?? undefined,
    user: {
      email, firstName, lastName, phone,
      fbc:        resolvedFbc        ?? undefined,
      fbp:        resolvedFbp        ?? undefined,
      externalId: resolvedFingerprint ?? undefined,
      clientIp:   resolvedIp         ?? undefined,
      userAgent:  resolvedUa         ?? undefined,
      city:       resolvedCity       ?? undefined,
      state:      resolvedRegion     ?? undefined,
      country:    resolvedCountry    ?? undefined,
    },
    value:    eventName === 'Purchase' ? dealValue : undefined,
    currency: opportunity?.currency ?? 'CAD',
    orderId:  opportunity?.id ?? undefined,
    contactId: contactRowId,
    source:    'ghl_webhook',
  });

  return NextResponse.json({
    ok: true,
    capi_sent:  capi.ok,
    resolution: session.tier,   // which tier matched (or null)
  });
}
