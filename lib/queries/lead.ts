/**
 * Lead/contact detail queries — used by /leads and /leads/[id].
 *
 * loadLeadList     — paginated list of recent contacts for the index page.
 * loadLeadJourney  — single contact with their full timeline (page views,
 *                    pipeline events, CAPI sends), enabling the customer-
 *                    journey waterfall on the detail page.
 */

import { maybeServiceClient } from '@/lib/supabase/server';

export interface LeadListRow {
  id:              number;
  ghl_contact_id:  string;
  first_name:      string | null;
  last_name:       string | null;
  email:           string | null;
  phone:           string | null;
  utm_source:      string | null;
  utm_campaign:    string | null;
  fbclid:          string | null;
  opted_in_at:     string | null;
  created_at:      string;
}

export interface JourneyEvent {
  kind:       'pageview' | 'pipeline' | 'capi';
  event_id:   string;
  event_name: string;
  event_time: string;            // ISO
  meta?:      Record<string, unknown>;
}

export interface LeadJourney {
  contact: {
    id:                 number;
    ghl_contact_id:     string | null;
    first_name:         string | null;
    last_name:          string | null;
    email:              string | null;
    phone:              string | null;
    utm_source:         string | null;
    utm_medium:         string | null;
    utm_campaign:       string | null;
    utm_content:        string | null;
    utm_term:           string | null;
    fbclid:             string | null;
    fingerprint:        string | null;
    clarity_session_url: string | null;
    opted_in_at:        string | null;
    created_at:         string;
    notes:              string | null;
    lead_status:        string | null;
  };
  events:              JourneyEvent[];
  page_view_count:     number;
  pipeline_event_count: number;
  capi_event_count:    number;
  /** First page view tells us where they came from. */
  origin: {
    page_url:    string | null;
    referrer:    string | null;
    device_type: string | null;
    browser:     string | null;
    os:          string | null;
    country:     string | null;
    region:      string | null;
    city:        string | null;
    user_agent:  string | null;
  } | null;
}

export async function loadLeadList(limit = 100): Promise<LeadListRow[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('ghl_contacts')
    .select('id, ghl_contact_id, first_name, last_name, email, phone, utm_source, utm_campaign, fbclid, opted_in_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[loadLeadList] error:', error.message);
    return [];
  }
  return (data ?? []) as unknown as LeadListRow[];
}

export async function loadLeadJourney(contactId: number): Promise<LeadJourney | null> {
  const sb = maybeServiceClient();
  if (!sb) return null;

  const [contactRes, pvRes, evRes, capiRes] = await Promise.all([
    sb.from('ghl_contacts').select('*').eq('id', contactId).single(),
    sb.from('page_view_events')
      .select('id, event_id, event_name, event_time, page_url, page_slug, referrer, device_type, browser, os, country, region, city, user_agent')
      .eq('contact_id', contactId).order('event_time', { ascending: true }),
    sb.from('ghl_pipeline_events')
      .select('id, ghl_event_id, event_name, event_time, deal_value, rep_name, pipeline_stage')
      .eq('contact_id', contactId).order('event_time', { ascending: true }),
    sb.from('capi_event_log')
      .select('id, event_id, event_name, event_time, source, sent_ok, last_error, match_keys_sent, response')
      .eq('contact_id', contactId).order('event_time', { ascending: true }),
  ]);

  if (contactRes.error || !contactRes.data) {
    console.warn('[loadLeadJourney] contact lookup failed:', contactRes.error?.message);
    return null;
  }

  const c: any = contactRes.data;
  const pageViews   = (pvRes.data   ?? []) as any[];
  const pipelineRow = (evRes.data   ?? []) as any[];
  const capiRows    = (capiRes.data ?? []) as any[];

  // Build a unified timeline of events.
  const events: JourneyEvent[] = [];
  for (const r of pageViews) {
    events.push({
      kind:       'pageview',
      event_id:   r.event_id,
      event_name: r.event_name,
      event_time: r.event_time,
      meta: {
        page_url:    r.page_url,
        page_slug:   r.page_slug,
        device_type: r.device_type,
        browser:     r.browser,
        os:          r.os,
        country:     r.country,
        region:      r.region,
        city:        r.city,
      },
    });
  }
  for (const r of pipelineRow) {
    events.push({
      kind:       'pipeline',
      event_id:   r.ghl_event_id || `pipeline-${r.id}`,
      event_name: r.event_name,
      event_time: r.event_time,
      meta: {
        deal_value:     r.deal_value,
        rep_name:       r.rep_name,
        pipeline_stage: r.pipeline_stage,
      },
    });
  }
  for (const r of capiRows) {
    events.push({
      kind:       'capi',
      event_id:   r.event_id,
      event_name: r.event_name,
      event_time: r.event_time,
      meta: {
        source:          r.source,
        sent_ok:         r.sent_ok,
        last_error:      r.last_error,
        match_keys_sent: r.match_keys_sent,
        events_received: (r.response as any)?.events_received,
      },
    });
  }

  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  const firstPv = pageViews[0];
  const origin = firstPv ? {
    page_url:    firstPv.page_url    ?? null,
    referrer:    firstPv.referrer    ?? null,
    device_type: firstPv.device_type ?? null,
    browser:     firstPv.browser     ?? null,
    os:          firstPv.os          ?? null,
    country:     firstPv.country     ?? null,
    region:      firstPv.region      ?? null,
    city:        firstPv.city        ?? null,
    user_agent:  firstPv.user_agent  ?? null,
  } : null;

  return {
    contact: {
      id:                  c.id,
      ghl_contact_id:      c.ghl_contact_id     ?? null,
      first_name:          c.first_name         ?? null,
      last_name:           c.last_name          ?? null,
      email:               c.email              ?? null,
      phone:               c.phone              ?? null,
      utm_source:          c.utm_source         ?? null,
      utm_medium:          c.utm_medium         ?? null,
      utm_campaign:        c.utm_campaign       ?? null,
      utm_content:         c.utm_content        ?? null,
      utm_term:            c.utm_term           ?? null,
      fbclid:              c.fbclid             ?? null,
      fingerprint:         c.fingerprint        ?? null,
      clarity_session_url: c.clarity_session_url ?? null,
      opted_in_at:         c.opted_in_at        ?? null,
      created_at:          c.created_at,
      notes:               c.notes              ?? null,
      lead_status:         c.lead_status        ?? null,
    },
    events,
    page_view_count:      pageViews.length,
    pipeline_event_count: pipelineRow.length,
    capi_event_count:     capiRows.length,
    origin,
  };
}
