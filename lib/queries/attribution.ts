/**
 * Attribution aggregation across meta_ad_performance + page_view_events +
 * ghl_pipeline_events. Joined in JS by Meta's immutable hierarchy IDs.
 *
 * 5 drill levels: source | campaign | adset | medium | ad.
 * Hierarchical drill — supply `filter.source`, `filter.campaign`, `filter.adset`
 * to scope deeper levels.
 *
 * Join keys are the Meta IDs carried on the ad URL template:
 *   utm_campaignid = {{campaign.id}}  → meta_ad_performance.campaign_id
 *   utm_adsetid    = {{adset.id}}     → meta_ad_performance.adset_id
 *   utm_adid       = {{ad.id}}        → meta_ad_performance.ad_id
 * Display names come from utm_campaign / utm_adset / utm_content, but are
 * overridden by the canonical Meta name looked up by ID. Joining on the
 * immutable ID — not the name — means a campaign/adset/ad rename never splits
 * a row's spend from its conversions.
 *
 * Filters (drill-down) are name-based: the dashboard passes the clicked row's
 * label (a name) as the filter for the next level. Names are unique in practice
 * within an already-scoped parent, so name filtering is safe; the ID join is
 * what keeps spend and conversions precisely aligned.
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

// The Meta ad URL template tags clicks with these. Spend rows are tagged with
// the same source/medium so they bucket together with their conversions at the
// source/medium levels. MUST match the utm_source / utm_medium you set in the
// Meta Ads Manager URL parameters.
const SPEND_SOURCE = 'facebook';
const SPEND_MEDIUM = 'cpc';

export interface AttributionFilter {
  source?:   string;
  campaign?: string;
  adset?:    string;
  active?:   boolean;
}

export interface AttributionRow {
  key:        string;
  label:      string;
  /** Creative preview — populated only when drill level = 'ad'. */
  thumbnail_url?: string | null;
  permalink_url?: string | null;

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

// ── Normalized hierarchy dimensions for one row (spend OR conversion) ────────
interface Dims {
  source:        string | null;
  medium:        string | null;
  campaign_id:   string | null;
  campaign_name: string | null;
  adset_id:      string | null;
  adset_name:    string | null;
  ad_id:         string | null;
  ad_name:       string | null;
}

interface NameMaps {
  campaign: Map<string, string>;   // campaign_id → canonical campaign_name
  adset:    Map<string, string>;   // adset_id    → canonical adset_name
  ad:       Map<string, string>;   // ad_id       → canonical ad_name
}

/**
 * Canonical display name for a level. Prefers the Meta-side name looked up by
 * ID (authoritative, survives renames in our data because spend is re-pulled),
 * then the name the row carried, then the raw ID, then a placeholder.
 */
function nameFor(level: DrillLevel, d: Dims, names: NameMaps): string {
  switch (level) {
    case 'source':   return d.source || '(direct)';
    case 'medium':   return d.medium || '(none)';
    case 'campaign': return (d.campaign_id ? names.campaign.get(d.campaign_id) : null) || d.campaign_name || d.campaign_id || '(no campaign)';
    case 'adset':    return (d.adset_id    ? names.adset.get(d.adset_id)       : null) || d.adset_name    || d.adset_id    || '(no adset)';
    case 'ad':       return (d.ad_id       ? names.ad.get(d.ad_id)             : null) || d.ad_name       || d.ad_id       || '(no ad)';
  }
}

/** Bucket key = the immutable ID (rename-proof); label = the canonical name. */
function bucketKey(level: DrillLevel, d: Dims, names: NameMaps): { key: string; label: string } {
  const label = nameFor(level, d, names);
  switch (level) {
    case 'source':   return { key: d.source || '(direct)',                       label };
    case 'medium':   return { key: d.medium || '(none)',                         label };
    case 'campaign': return { key: d.campaign_id || d.campaign_name || '(no campaign)', label };
    case 'adset':    return { key: d.adset_id    || d.adset_name    || '(no adset)',    label };
    case 'ad':       return { key: d.ad_id       || d.ad_name       || '(no ad)',       label };
  }
}

const UTM_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'utm_adset', 'utm_adid', 'utm_adsetid', 'utm_campaignid',
] as const;

type UtmSet = Record<(typeof UTM_KEYS)[number], string | null>;

/** Merge UTM candidates — first non-null wins (event row, then contact). */
function resolveUtms(...candidates: Array<Partial<UtmSet> | null | undefined>): UtmSet {
  const out = Object.fromEntries(UTM_KEYS.map((k) => [k, null])) as UtmSet;
  for (const c of candidates) {
    if (!c) continue;
    for (const k of UTM_KEYS) {
      if (!out[k] && (c as any)[k]) out[k] = (c as any)[k];
    }
  }
  return out;
}

/** A conversion (page view / pipeline event / contact) → hierarchy dimensions. */
function utmDims(u: UtmSet): Dims {
  return {
    source:        u.utm_source,
    medium:        u.utm_medium,
    campaign_id:   u.utm_campaignid,
    campaign_name: u.utm_campaign,
    adset_id:      u.utm_adsetid,
    adset_name:    u.utm_adset,
    ad_id:         u.utm_adid,
    ad_name:       u.utm_content,
  };
}

/** A Meta spend row → hierarchy dimensions. */
function spendDims(rr: any): Dims {
  return {
    source:        SPEND_SOURCE,
    medium:        SPEND_MEDIUM,
    campaign_id:   rr.campaign_id ?? null,
    campaign_name: rr.campaign_name ?? null,
    adset_id:      rr.adset_id ?? null,
    adset_name:    rr.adset_name ?? null,
    ad_id:         rr.ad_id ?? null,
    ad_name:       rr.ad_name ?? null,
  };
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

  const [spendRes, pvRes, evRes, contactsRes, creativesRes] = await Promise.all([
    sb.from('meta_ad_performance').select('*').gte('date', fromISO).lte('date', toISO),
    sb.from('page_view_events').select('*').gte('event_time', fromISO).lte('event_time', toEnd),
    sb.from('ghl_pipeline_events').select('*').gte('event_time', fromISO).lte('event_time', toEnd),
    sb.from('ghl_contacts').select(
      'id,utm_source,utm_medium,utm_campaign,utm_content,utm_term,utm_adset,utm_adid,utm_adsetid,utm_campaignid',
    ),
    // Only loaded when we're drilled to ad level — saves a fetch otherwise.
    level === 'ad'
      ? sb.from('ad_creatives').select('ad_id, thumbnail_url, permalink_url')
      : Promise.resolve({ data: [] as any[], error: null as any }),
  ]);

  if (spendRes.error || pvRes.error || evRes.error || contactsRes.error) {
    console.warn('[attribution] supabase error:',
      spendRes.error?.message, pvRes.error?.message,
      evRes.error?.message,    contactsRes.error?.message);
    return [];
  }

  // Canonical ID→name maps from Meta spend (the authoritative source of names).
  const names: NameMaps = { campaign: new Map(), adset: new Map(), ad: new Map() };
  for (const r of spendRes.data ?? []) {
    const rr = r as any;
    if (rr.campaign_id && rr.campaign_name) names.campaign.set(rr.campaign_id, rr.campaign_name);
    if (rr.adset_id    && rr.adset_name)    names.adset.set(rr.adset_id, rr.adset_name);
    if (rr.ad_id       && rr.ad_name)       names.ad.set(rr.ad_id, rr.ad_name);
  }

  // ad_id → creative URLs (only when level === 'ad')
  const creativeById = new Map<string, { thumbnail_url: string | null; permalink_url: string | null }>();
  for (const c of creativesRes.data ?? []) {
    const cc = c as any;
    if (cc.ad_id) creativeById.set(cc.ad_id, { thumbnail_url: cc.thumbnail_url, permalink_url: cc.permalink_url });
  }

  // contact_id → contact's UTMs (fallback when an event row lacks them)
  const contactUtms = new Map<number, UtmSet>();
  for (const c of contactsRes.data ?? []) {
    const cc = c as any;
    contactUtms.set(cc.id, resolveUtms(cc));
  }

  // Name-based scope filter (matches what the dashboard passes on drill-down).
  function passesFilter(d: Dims): boolean {
    if (filter.source   && nameFor('source',   d, names) !== filter.source)   return false;
    if (filter.campaign && nameFor('campaign', d, names) !== filter.campaign) return false;
    if (filter.adset    && nameFor('adset',    d, names) !== filter.adset)    return false;
    return true;
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

    const d = spendDims(rr);
    if (!passesFilter(d)) continue;
    if (filter.active && !isActiveStatus(status)) continue;

    const { key, label } = bucketKey(level, d, names);
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
    const d = utmDims(resolveUtms(rr, contactRow));
    if (!passesFilter(d)) continue;

    const { key, label } = bucketKey(level, d, names);
    bucket(key, label).page_views += 1;
  }

  // ── Pipeline events (GHL) ─────────────────────────────────────────
  for (const r of evRes.data ?? []) {
    const rr = r as any;
    const contactRow = rr.contact_id ? contactUtms.get(rr.contact_id) : null;
    const d = utmDims(resolveUtms(rr, contactRow));
    if (!passesFilter(d)) continue;

    const { key, label } = bucketKey(level, d, names);
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

  const out = Array.from(bucketsMap.values()).map((b) => {
    const creative = level === 'ad' ? creativeById.get(b.key) : undefined;
    return {
      ...b,
      thumbnail_url: creative?.thumbnail_url ?? null,
      permalink_url: creative?.permalink_url ?? null,
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
    };
  });

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
