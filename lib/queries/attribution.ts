/**
 * Attribution aggregation across meta_ad_performance + page_view_events +
 * ghl_pipeline_events. Joined in JS by UTM keys + Meta's own hierarchy.
 *
 * 5 drill levels: source | campaign | adset | medium | ad.
 * Hierarchical drill — supply `filter.source`, `filter.campaign`, `filter.adset`
 * to scope deeper levels.
 *
 * Active-only flag hides rows where Meta's effective_status is paused/archived.
 *
 * UTM resolution cascade (per spec step 8):
 *   1. UTMs on the event row itself
 *   2. UTMs on the linked contact (inherited from session at webhook time)
 *
 * Each row carries BOTH the calculated funnel metrics (from our data) AND
 * Meta's reported metrics (from the insights API) so the dashboard can show
 * the delta side-by-side.
 */

import { maybeServiceClient } from '@/lib/supabase/server';

export type DrillLevel = 'source' | 'campaign' | 'adset' | 'medium' | 'ad';

export interface AttributionFilter {
  source?:   string;
  campaign?: string;
  adset?:    string;
  active?:   boolean;
}

export interface AttributionRow {
  key:        string;
  label:      string;

  // ── Our calculated metrics ─────────────────────────────────
  spend:      number;
  page_views: number;
  leads:      number;
  booked:     number;
  unique_booked: number;        // deduped per contact_id
  shown:      number;
  closes:     number;
  revenue:    number;
  status?:    string | null;

  // Derived from "our" metrics
  cpl?:           number | null;
  cost_booked?:   number | null;
  cost_shown?:    number | null;
  cac?:           number | null;
  roas?:          number | null;
  roi_pct?:       number | null;        // (revenue - spend) / spend × 100

  // ── Meta-reported metrics (summed from meta_ad_performance) ─
  impressions:        number;
  clicks:             number;
  reach:              number;
  meta_leads:         number;
  meta_purchases:     number;
  unique_link_clicks: number;
  video_p3_watched:   number;
  video_play_actions: number;

  // Derived from Meta totals (recomputed; NOT averaged from per-day rates)
  ctr?:                  number | null;   // clicks ÷ impressions
  cpc?:                  number | null;   // spend ÷ clicks
  cpm?:                  number | null;   // spend ÷ impressions × 1000
  hook_rate?:            number | null;   // 3-sec views ÷ impressions
  video_play_rate?:      number | null;   // any plays ÷ impressions
  meta_cpl?:             number | null;   // spend ÷ meta_leads
  cost_per_link_click?:  number | null;   // spend ÷ unique_link_clicks
}

const EMPTY: AttributionRow = {
  key: '', label: '',
  spend: 0, page_views: 0, leads: 0, booked: 0, unique_booked: 0,
  shown: 0, closes: 0, revenue: 0,
  impressions: 0, clicks: 0, reach: 0,
  meta_leads: 0, meta_purchases: 0,
  unique_link_clicks: 0, video_p3_watched: 0, video_play_actions: 0,
};

function isActiveStatus(s?: string | null): boolean {
  if (!s) return true;
  return s === 'ACTIVE';
}

function bucketKey(level: DrillLevel, row: any): { key: string; label: string } {
  switch (level) {
    case 'source':   return { key: row.utm_source   || '(direct)',     label: row.utm_source   || '(direct)' };
    case 'medium':   return { key: row.utm_medium   || '(none)',       label: row.utm_medium   || '(none)' };
    case 'campaign': return { key: row.utm_campaign || '(no campaign)', label: row.utm_campaign || '(no campaign)' };
    case 'adset':    return { key: row.adset_name   || row.adset_id || '(no adset)', label: row.adset_name || row.adset_id || '(no adset)' };
    case 'ad':       return {
      key:   row.ad_name || `${row.utm_campaign || ''}|${row.utm_content || ''}`,
      label: row.ad_name || row.utm_content || '(no ad)',
    };
  }
}

type UtmSet = {
  utm_source:   string | null;
  utm_medium:   string | null;
  utm_campaign: string | null;
  utm_content:  string | null;
  utm_term:     string | null;
};

function resolveUtms(...candidates: Array<Partial<UtmSet> | null | undefined>): UtmSet {
  const out: UtmSet = {
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
  };
  for (const c of candidates) {
    if (!c) continue;
    if (!out.utm_source   && c.utm_source)   out.utm_source   = c.utm_source;
    if (!out.utm_medium   && c.utm_medium)   out.utm_medium   = c.utm_medium;
    if (!out.utm_campaign && c.utm_campaign) out.utm_campaign = c.utm_campaign;
    if (!out.utm_content  && c.utm_content)  out.utm_content  = c.utm_content;
    if (!out.utm_term     && c.utm_term)     out.utm_term     = c.utm_term;
  }
  return out;
}

export async function aggregateAttribution(
  level: DrillLevel,
  fromISO: string,
  toISO: string,
  filter: AttributionFilter = {},
): Promise<AttributionRow[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];

  const toEnd = `${toISO}T23:59:59.999Z`;

  const [spendRes, pvRes, evRes, contactsRes] = await Promise.all([
    sb.from('meta_ad_performance').select('*').gte('date', fromISO).lte('date', toISO),
    sb.from('page_view_events').select('*').gte('event_time', fromISO).lte('event_time', toEnd),
    sb.from('ghl_pipeline_events').select('*').gte('event_time', fromISO).lte('event_time', toEnd),
    sb.from('ghl_contacts').select('id,utm_source,utm_medium,utm_campaign,utm_content,utm_term'),
  ]);

  if (spendRes.error || pvRes.error || evRes.error || contactsRes.error) {
    console.warn('[attribution] supabase error:',
      spendRes.error?.message, pvRes.error?.message,
      evRes.error?.message,    contactsRes.error?.message);
    return [];
  }

  // contact_id → contact's UTMs
  const contactUtms = new Map<number, UtmSet>();
  for (const c of contactsRes.data ?? []) {
    const cc = c as any;
    contactUtms.set(cc.id, {
      utm_source:   cc.utm_source,
      utm_medium:   cc.utm_medium,
      utm_campaign: cc.utm_campaign,
      utm_content:  cc.utm_content,
      utm_term:     cc.utm_term,
    });
  }

  // For unique_booked deduping
  const bookedSeen = new Map<string, Set<number>>();   // bucket key → Set<contact_id>

  const bucketsMap = new Map<string, AttributionRow>();
  function bucket(key: string, label: string, status?: string | null): AttributionRow {
    let b = bucketsMap.get(key);
    if (!b) { b = { ...EMPTY, key, label, status: status ?? null }; bucketsMap.set(key, b); }
    if (status === 'ACTIVE') b.status = 'ACTIVE';
    else if (!b.status && status) b.status = status;
    return b;
  }

  // ── Spend rows (Meta) ────────────────────────────────────────────
  for (const r of spendRes.data ?? []) {
    const rr = r as any;
    const status: string | undefined =
      (rr.effective_status as string | null) ?? rr.raw_payload?.effective_status ?? undefined;

    if (filter.source && filter.source !== 'meta') continue;
    if (filter.campaign && rr.campaign_name !== filter.campaign) continue;
    if (filter.adset    && rr.adset_name    !== filter.adset)    continue;
    if (filter.active && !isActiveStatus(status))                continue;

    const synthetic = {
      utm_source:   'meta',
      utm_medium:   'paid-social',
      utm_campaign: rr.campaign_name,
      utm_content:  rr.ad_name,
      ad_name:      rr.ad_name,
      adset_name:   rr.adset_name,
      adset_id:     rr.adset_id,
    };
    const { key, label } = bucketKey(level, synthetic);
    const b = bucket(key, label, status);

    b.spend              += Number(rr.spend)              || 0;
    b.impressions        += Number(rr.impressions)        || 0;
    b.clicks             += Number(rr.clicks)             || 0;
    b.reach              += Number(rr.reach)              || 0;
    b.meta_leads         += Number(rr.meta_leads)         || 0;
    b.meta_purchases     += Number(rr.meta_purchases)     || 0;
    b.unique_link_clicks += Number(rr.unique_link_clicks) || 0;
    b.video_p3_watched   += Number(rr.video_p3_watched)   || 0;
    b.video_play_actions += Number(rr.video_play_actions) || 0;
  }

  // ── Page views ────────────────────────────────────────────────────
  for (const r of pvRes.data ?? []) {
    const rr = r as any;
    const contactRow = rr.contact_id ? contactUtms.get(rr.contact_id) : null;
    const utms = resolveUtms(rr, contactRow);

    if (filter.source   && (utms.utm_source   || '(direct)')     !== filter.source)   continue;
    if (filter.campaign && (utms.utm_campaign || '(no campaign)') !== filter.campaign) continue;
    if (filter.adset && (level === 'adset' || level === 'ad')) continue;

    const { key, label } = bucketKey(level, utms);
    const b = bucket(key, label);
    b.page_views += 1;
  }

  // ── Pipeline events (GHL) ─────────────────────────────────────────
  for (const r of evRes.data ?? []) {
    const rr = r as any;
    const contactRow = rr.contact_id ? contactUtms.get(rr.contact_id) : null;
    const utms = resolveUtms(rr, contactRow);

    if (filter.source   && (utms.utm_source   || '(direct)')     !== filter.source)   continue;
    if (filter.campaign && (utms.utm_campaign || '(no campaign)') !== filter.campaign) continue;
    if (filter.adset    && (level === 'adset' || level === 'ad')) continue;

    const { key, label } = bucketKey(level, utms);
    const b = bucket(key, label);

    switch (rr.event_name) {
      case 'Lead':
        b.leads += 1;
        break;
      case 'AppointmentBooked':
        b.booked += 1;
        // Unique booked: count distinct contacts per bucket.
        if (rr.contact_id != null) {
          let set = bookedSeen.get(key);
          if (!set) { set = new Set(); bookedSeen.set(key, set); }
          set.add(rr.contact_id);
        }
        break;
      case 'AppointmentShown': b.shown  += 1; break;
      case 'Purchase':         b.closes += 1; b.revenue += Number(rr.deal_value) || 0; break;
    }
  }

  // Hydrate unique_booked from the per-bucket Sets
  for (const [key, set] of bookedSeen) {
    const b = bucketsMap.get(key);
    if (b) b.unique_booked = set.size;
  }

  const out = Array.from(bucketsMap.values()).map((b) => ({
    ...b,
    // funnel-derived
    cpl:         b.leads  > 0 ? b.spend / b.leads  : null,
    cost_booked: b.booked > 0 ? b.spend / b.booked : null,
    cost_shown:  b.shown  > 0 ? b.spend / b.shown  : null,
    cac:         b.closes > 0 ? b.spend / b.closes : null,
    roas:        b.spend  > 0 ? b.revenue / b.spend : null,
    roi_pct:     b.spend  > 0 ? ((b.revenue - b.spend) / b.spend) * 100 : null,

    // Meta-derived (recomputed from summed totals)
    ctr:                 b.impressions > 0 ? b.clicks / b.impressions : null,
    cpc:                 b.clicks > 0      ? b.spend  / b.clicks      : null,
    cpm:                 b.impressions > 0 ? (b.spend / b.impressions) * 1000 : null,
    hook_rate:           b.impressions > 0 ? b.video_p3_watched   / b.impressions : null,
    video_play_rate:     b.impressions > 0 ? b.video_play_actions / b.impressions : null,
    meta_cpl:            b.meta_leads > 0        ? b.spend / b.meta_leads        : null,
    cost_per_link_click: b.unique_link_clicks > 0 ? b.spend / b.unique_link_clicks : null,
  }));

  out.sort((a, b) => b.spend - a.spend);
  return out;
}

export function totalsRow(rows: AttributionRow[]): AttributionRow {
  const t: AttributionRow = { ...EMPTY, key: '__total', label: 'Total' };
  for (const r of rows) {
    t.spend              += r.spend;
    t.page_views         += r.page_views;
    t.leads              += r.leads;
    t.booked             += r.booked;
    t.unique_booked      += r.unique_booked;
    t.shown              += r.shown;
    t.closes             += r.closes;
    t.revenue            += r.revenue;
    t.impressions        += r.impressions;
    t.clicks             += r.clicks;
    t.reach              += r.reach;
    t.meta_leads         += r.meta_leads;
    t.meta_purchases     += r.meta_purchases;
    t.unique_link_clicks += r.unique_link_clicks;
    t.video_p3_watched   += r.video_p3_watched;
    t.video_play_actions += r.video_play_actions;
  }
  t.cpl         = t.leads  > 0 ? t.spend / t.leads  : null;
  t.cost_booked = t.booked > 0 ? t.spend / t.booked : null;
  t.cost_shown  = t.shown  > 0 ? t.spend / t.shown  : null;
  t.cac         = t.closes > 0 ? t.spend / t.closes : null;
  t.roas        = t.spend  > 0 ? t.revenue / t.spend : null;
  t.roi_pct     = t.spend  > 0 ? ((t.revenue - t.spend) / t.spend) * 100 : null;

  t.ctr                 = t.impressions > 0 ? t.clicks / t.impressions : null;
  t.cpc                 = t.clicks > 0      ? t.spend  / t.clicks      : null;
  t.cpm                 = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null;
  t.hook_rate           = t.impressions > 0 ? t.video_p3_watched   / t.impressions : null;
  t.video_play_rate     = t.impressions > 0 ? t.video_play_actions / t.impressions : null;
  t.meta_cpl            = t.meta_leads > 0  ? t.spend / t.meta_leads  : null;
  t.cost_per_link_click = t.unique_link_clicks > 0 ? t.spend / t.unique_link_clicks : null;
  return t;
}
