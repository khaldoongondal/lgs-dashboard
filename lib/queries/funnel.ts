/**
 * Funnel waterfall aggregation.
 *
 * Pulls raw signals from page_view_events (browser pixel) + ghl_pipeline_events
 * (server-side authoritative) and turns them into the 6-step funnel:
 *
 *   VSL Visitors → CTA Clicks → Opt-ins → Bookings → Shows → Closes
 *
 * Per-step we surface:
 *   - absolute count
 *   - conversion % from previous step
 *   - drop-off % from previous step
 *   - benchmark traffic-light (green / amber / red)
 *
 * Identity for unique visitors: COALESCE(fingerprint, fbclid, client_ip).
 * Fingerprint preferred; fbclid second; IP as last-resort fallback so we
 * don't lose count when neither pixel nor fbclid is available.
 */

import { maybeServiceClient } from '@/lib/supabase/server';

export type PageSlug = 'vsl' | 'optin' | 'booking' | 'thankyou' | 'other';

export interface FunnelStep {
  key:        string;
  label:      string;
  count:      number;
  /** Conversion percentage relative to the previous step (0..1). null for first step. */
  conversion: number | null;
  /** Drop-off percentage relative to the previous step (0..1). null for first step. */
  dropoff:    number | null;
  /** Benchmark band — UI uses it to colour the row green / amber / red. */
  band:       'green' | 'amber' | 'red' | 'neutral';
}

export interface FunnelData {
  steps:        FunnelStep[];
  fullFunnel:   number | null;   // closes / VSL visitors (0..1)
  pageBreakdown: PageBreakdownRow[];
  range:        { from: string; to: string };
}

export interface PageBreakdownRow {
  page_slug:       PageSlug | string;
  unique_visitors: number;
  page_views:      number;
}

/**
 * Industry-typical benchmarks. Tweak per business. Each pair is
 * { ok: <minimum-acceptable>, good: <strong> } as fractions.
 */
const BENCHMARKS: Record<string, { ok: number; good: number }> = {
  cta:     { ok: 0.20, good: 0.40 },
  optin:   { ok: 0.30, good: 0.50 },   // CTA → opt-in
  booking: { ok: 0.25, good: 0.50 },   // opt-in → booked
  shown:   { ok: 0.50, good: 0.70 },   // booked → shown
  close:   { ok: 0.15, good: 0.30 },   // shown → close
};

function band(rate: number | null, key: keyof typeof BENCHMARKS): FunnelStep['band'] {
  if (rate === null) return 'neutral';
  const b = BENCHMARKS[key];
  if (!b) return 'neutral';
  if (rate >= b.good) return 'green';
  if (rate >= b.ok)   return 'amber';
  return 'red';
}

const EMPTY: FunnelData = {
  steps:        [],
  fullFunnel:   null,
  pageBreakdown: [],
  range:        { from: '', to: '' },
};

export async function aggregateFunnel(
  fromISO: string,
  toISO: string,
): Promise<FunnelData> {
  const sb = maybeServiceClient();
  if (!sb) return EMPTY;

  const toEnd = `${toISO}T23:59:59.999Z`;

  const [pvRes, evRes] = await Promise.all([
    sb.from('page_view_events')
      .select('event_name, page_slug, fingerprint, fbclid, client_ip')
      .gte('event_time', fromISO).lte('event_time', toEnd),
    sb.from('ghl_pipeline_events')
      .select('event_name, contact_id')
      .gte('event_time', fromISO).lte('event_time', toEnd),
  ]);

  if (pvRes.error || evRes.error) {
    console.warn('[funnel] supabase error:', pvRes.error?.message, evRes.error?.message);
    return { ...EMPTY, range: { from: fromISO, to: toISO } };
  }

  // ── Identity-deduped unique visitors per page slug ───────────────────
  const visitorsByPage = new Map<string, Set<string>>();
  const pvCountByPage  = new Map<string, number>();

  // Pixel-side conversion counts
  let pixelCtaClicks = 0;
  let pixelOptIns    = 0;
  let pixelBookings  = 0;

  for (const r of pvRes.data ?? []) {
    const rr = r as any;
    const id: string = rr.fingerprint || rr.fbclid || rr.client_ip || '';
    const slug = (rr.page_slug || 'other') as string;

    if (rr.event_name === 'PageView') {
      pvCountByPage.set(slug, (pvCountByPage.get(slug) ?? 0) + 1);
      if (id) {
        let set = visitorsByPage.get(slug);
        if (!set) { set = new Set(); visitorsByPage.set(slug, set); }
        set.add(id);
      }
    } else if (rr.event_name === 'CTAClick') pixelCtaClicks++;
    else if  (rr.event_name === 'OptIn')    pixelOptIns++;
    else if  (rr.event_name === 'Booking')  pixelBookings++;
  }

  // ── GHL pipeline counts (authoritative for downstream) ───────────────
  let ghlLeads = 0, ghlBooked = 0, ghlShown = 0, ghlClosed = 0;
  for (const r of evRes.data ?? []) {
    const rr = r as any;
    switch (rr.event_name) {
      case 'Lead':              ghlLeads++;  break;
      case 'AppointmentBooked': ghlBooked++; break;
      case 'AppointmentShown':  ghlShown++;  break;
      case 'Purchase':          ghlClosed++; break;
    }
  }

  const vslVisitors = visitorsByPage.get('vsl')?.size ?? 0;
  // Prefer the GHL count when available (server-side, deduped by contact).
  // Fall back to pixel count for sites that haven't wired GHL workflows yet.
  const optIns   = ghlLeads  > 0 ? ghlLeads  : pixelOptIns;
  const bookings = ghlBooked > 0 ? ghlBooked : pixelBookings;
  const shows    = ghlShown;
  const closes   = ghlClosed;

  // ── Assemble waterfall ───────────────────────────────────────────────
  function step(
    key: FunnelStep['key'],
    label: string,
    count: number,
    prev: number | null,
    benchKey: keyof typeof BENCHMARKS | null,
  ): FunnelStep {
    const conversion = prev !== null && prev > 0 ? count / prev : null;
    const dropoff    = conversion !== null ? 1 - conversion : null;
    return {
      key, label, count,
      conversion,
      dropoff,
      band: benchKey ? band(conversion, benchKey) : 'neutral',
    };
  }

  const steps: FunnelStep[] = [
    step('visitors', 'VSL Visitors',  vslVisitors,    null,         null),
    step('cta',      'CTA Clicks',    pixelCtaClicks, vslVisitors,  'cta'),
    step('optin',    'Opt-ins',       optIns,         vslVisitors,  'optin'),
    step('booking',  'Bookings',      bookings,       optIns,       'booking'),
    step('shown',    'Shows',         shows,          bookings,     'shown'),
    step('close',    'Closes',        closes,         shows,        'close'),
  ];

  const fullFunnel = vslVisitors > 0 ? closes / vslVisitors : null;

  // ── Per-page breakdown ───────────────────────────────────────────────
  const pageBreakdown: PageBreakdownRow[] = [];
  const slugOrder: PageSlug[] = ['vsl', 'optin', 'booking', 'thankyou'];
  for (const slug of slugOrder) {
    pageBreakdown.push({
      page_slug:       slug,
      unique_visitors: visitorsByPage.get(slug)?.size ?? 0,
      page_views:      pvCountByPage.get(slug) ?? 0,
    });
  }

  return { steps, fullFunnel, pageBreakdown, range: { from: fromISO, to: toISO } };
}
