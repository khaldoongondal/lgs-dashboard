/**
 * Meta Conversions API (CAPI) sender.
 *
 * Ported from /_reference-evernude/services/meta-capi.js with:
 *  - 4 LGS event types (Lead, Schedule, AppointmentShown, Purchase) + ViewContent
 *  - Native fetch (no axios)
 *  - Audit log into capi_event_log (with retry-friendly attempt counter)
 *  - Optional test_event_code
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
 */

import { env } from '@/lib/env';
import { buildUserData, buildFbc, type UserDataInput } from '@/lib/hash';
import { serviceClient } from '@/lib/supabase/server';

const CAPI_VERSION = 'v21.0';
const CAPI_BASE    = 'https://graph.facebook.com';

/** Our internal event names → Meta's standard names. */
export const META_EVENT_MAP = {
  ContentView:        'ViewContent',
  PageView:           'ViewContent',
  Lead:               'Lead',
  AppointmentBooked:  'Schedule',         // GHL "appointment booked" → Meta "Schedule"
  AppointmentShown:   'CompleteRegistration', // proxy until Meta adds a native "Shown"
  Purchase:           'Purchase',
} as const;

export type InternalEvent = keyof typeof META_EVENT_MAP;

export interface CapiEvent {
  eventName:      InternalEvent;
  eventId:        string;
  eventTimeUnix:  number;             // seconds
  eventSourceUrl?: string;
  user:           UserDataInput;
  // Monetary
  value?:         number;
  currency?:      string;
  orderId?:       string;
  // Internal linkage
  contactId?:     number | null;
  source:         'pixel' | 'ghl_webhook' | 'shopify_webhook' | 'manual';
  // Override fbc construction time (ms) if you know the original click time
  fbcCreationTimeMs?: number;
}

export interface CapiResult {
  ok:       boolean;
  status:   number | null;
  response: unknown;
  error?:   string;
}

export async function sendCapiEvent(ev: CapiEvent): Promise<CapiResult> {
  const pixelId      = env.metaPixelId();
  const accessToken  = env.metaAccessToken();
  const testCode     = env.metaTestEventCode();

  if (!pixelId || !accessToken) {
    return logResult(ev, [], { ok: false, status: null, response: { error: 'CAPI not configured' }, error: 'CAPI not configured' });
  }

  const metaEventName = META_EVENT_MAP[ev.eventName];

  // Construct fbc only if we have an explicit fbclid in user-data and a known click time.
  const userInput: UserDataInput = { ...ev.user };
  if (!userInput.fbc && (userInput as any).fbclid) {
    userInput.fbc = buildFbc((userInput as any).fbclid, ev.fbcCreationTimeMs);
  }

  const { userData, matchKeys } = await buildUserData(userInput);

  const event: Record<string, unknown> = {
    event_name:       metaEventName,
    event_time:       ev.eventTimeUnix,
    event_id:         ev.eventId,
    event_source_url: ev.eventSourceUrl,
    action_source:    'website',
    user_data:        userData,
  };

  if (ev.eventName === 'Purchase' || ev.value != null) {
    event.custom_data = {
      currency:     ev.currency || 'CAD',
      value:        ev.value ?? 0,
      content_type: 'product',
      ...(ev.orderId ? { order_id: ev.orderId } : {}),
    };
  }

  const payload: Record<string, unknown> = { data: [event] };
  if (testCode) payload.test_event_code = testCode;

  const url = `${CAPI_BASE}/${CAPI_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      // Reasonable timeout via AbortController
      signal:  AbortSignal.timeout(8000),
    });
    const body: unknown = await res.json().catch(() => ({}));
    return logResult(ev, matchKeys, {
      ok: res.ok,
      status: res.status,
      response: body,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return logResult(ev, matchKeys, { ok: false, status: null, response: { error: message }, error: message });
  }
}

/** Best-effort write to capi_event_log. Never throws. */
async function logResult(ev: CapiEvent, matchKeys: string[], result: CapiResult): Promise<CapiResult> {
  try {
    const sb = serviceClient();
    await sb.from('capi_event_log').upsert(
      [{
        event_id:        ev.eventId,
        event_name:      META_EVENT_MAP[ev.eventName],
        event_time:      new Date(ev.eventTimeUnix * 1000).toISOString(),
        source:          ev.source,
        contact_id:      ev.contactId ?? null,
        payload:         { internal: ev },
        response:        result.response as object,
        sent_ok:         result.ok,
        last_error:      result.error ?? null,
        match_keys_sent: matchKeys,
      }],
      { onConflict: 'event_id,event_name', ignoreDuplicates: false }
    );
  } catch {
    // Logging is best-effort; do not let it mask the CAPI result.
  }
  return result;
}
