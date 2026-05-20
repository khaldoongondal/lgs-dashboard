/**
 * Attribution aggregation across meta_ad_performance + page_view_events +
 * ghl_pipeline_events. Joined in JS by UTM keys + Meta's own hierarchy.
 *
 * 5 drill levels: source | campaign | adset | medium | ad.
 * Hierarchical drill — supply `filter.source`, `filter.campaign`, `filter.adset`
 * to scope deeper levels.
 *
 * Active-only flag hides rows where Meta's effective_status is paused/archived.
 */

import { maybeServiceClient } from '@/lib/supabase/server';

export type DrillLevel = 'source' | 'campaign' | 'adset' | 'medium' | 'ad';

export interface AttributionFilter {
  source?:   string;   // utm_source bucket
  campaign?: string;   // utm_campaign / Meta campaign_name
  adset?:    string;   // Meta adset_name
  active?:   boolean;
}

export interface AttributionRow {
  key:        string;
  label:      string;
  spend:      number;
  page_views: number;
  leads:      number;
  booked:     number;
  shown:      number;
  closes:     number;
  revenue:    number;
  status?:    string | null;   // surfaced from raw_payload.effective_status
  // derived
  cpl?:           number | null;
  cost_booked?:   number | null;
  cost_shown?:    number | null;
  cac?:           number | null;
  roas?:          number | null;
}

const EMPTY: AttributionRow = {
  key: '', label: '', spend: 0, page_views: 0,
  leads: 0, booked: 0, shown: 0, closes: 0, revenue: 0,
};

const ACTIVE_STATUSES = new Set([
  'ACTIVE', 'CAMPAIGN_PAUSED' /* adset/ad still active under paused campaign — exclude */,
]);

function isActiveStatus(s?: string | null): boolean {
  if (!s) return true;   // unknown = treat as active so missing data doesn't disappear
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

export async function aggregateAttribution(
  level: DrillLevel,
  fromISO: string,
  toISO: string,
  filter: AttributionFilter = {},
): Promise<AttributionRow[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];

  const toEnd = `${toISO}T23:59:59.999Z`;

  const [spendRes, pvRes, evRes] = await Promise.all([
    sb.from('meta_ad_performance').select('*').gte('date', fromISO).lte('date', toISO),
    sb.from('page_view_events').select('*').gte('event_time', fromISO).lte('event_time', toEnd),
    sb.from('ghl_pipeline_events').select('*').gte('event_time', fromISO).lte('event_time', toEnd),
  ]);

  if (spendRes.error || pvRes.error || evRes.error) {
    console.warn('[attribution] supabase error:',
      spendRes.error?.message, pvRes.error?.message, evRes.error?.message);
    return [];
  }

  const bucketsMap = new Map<string, AttributionRow>();
  function bucket(key: string, label: string, status?: string | null): AttributionRow {
    let b = bucketsMap.get(key);
    if (!b) { b = { ...EMPTY, key, label, status: status ?? null }; bucketsMap.set(key, b); }
    // Promote ACTIVE if any contributing row is active
    if (status === 'ACTIVE') b.status = 'ACTIVE';
    else if (!b.status && status) b.status = status;
    return b;
  }

  // ── Spend rows (from Meta) ──────────────────────────────────────
  for (const r of spendRes.data ?? []) {
    const rr = r as any;
    const raw = rr.raw_payload ?? {};
    const status = raw.effective_status as string | undefined;

    // Hierarchical filtering — Meta spend rows are always source='meta'
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
    b.spend += Number(rr.spend) || 0;
  }

  // ── Page views (browser pixel) ──────────────────────────────────
  // Page views don't carry Meta's adset/ad_name, so only filter by source/campaign.
  for (const r of pvRes.data ?? []) {
    const rr = r as any;
    if (filter.source   && (rr.utm_source   || '(direct)')     !== filter.source)   continue;
    if (filter.campaign && (rr.utm_campaign || '(no campaign)') !== filter.campaign) continue;
    // adset filter can't apply to page views — skip them when drilling that deep
    if (filter.adset && (level === 'adset' || level === 'ad')) continue;

    const { key, label } = bucketKey(level, rr);
    const b = bucket(key, label);
    b.page_views += 1;
  }

  // ── Pipeline events (GHL) ───────────────────────────────────────
  for (const r of evRes.data ?? []) {
    const rr = r as any;
    if (filter.source   && (rr.utm_source   || '(direct)')     !== filter.source)   continue;
    if (filter.campaign && (rr.utm_campaign || '(no campaign)') !== filter.campaign) continue;
    if (filter.adset    && (level === 'adset' || level === 'ad')) continue;

    const { key, label } = bucketKey(level, rr);
    const b = bucket(key, label);
    switch (rr.event_name) {
      case 'Lead':              b.leads  += 1; break;
      case 'AppointmentBooked': b.booked += 1; break;
      case 'AppointmentShown':  b.shown  += 1; break;
      case 'Purchase':          b.closes += 1; b.revenue += Number(rr.deal_value) || 0; break;
    }
  }

  const out = Array.from(bucketsMap.values()).map((b) => ({
    ...b,
    cpl:         b.leads  > 0 ? b.spend / b.leads  : null,
    cost_booked: b.booked > 0 ? b.spend / b.booked : null,
    cost_shown:  b.shown  > 0 ? b.spend / b.shown  : null,
    cac:         b.closes > 0 ? b.spend / b.closes : null,
    roas:        b.spend  > 0 ? b.revenue / b.spend : null,
  }));

  out.sort((a, b) => b.spend - a.spend);
  return out;
}

export function totalsRow(rows: AttributionRow[]): AttributionRow {
  const t: AttributionRow = { ...EMPTY, key: '__total', label: 'Total' };
  for (const r of rows) {
    t.spend      += r.spend;
    t.page_views += r.page_views;
    t.leads      += r.leads;
    t.booked     += r.booked;
    t.shown      += r.shown;
    t.closes     += r.closes;
    t.revenue    += r.revenue;
  }
  t.cpl         = t.leads  > 0 ? t.spend / t.leads  : null;
  t.cost_booked = t.booked > 0 ? t.spend / t.booked : null;
  t.cost_shown  = t.shown  > 0 ? t.spend / t.shown  : null;
  t.cac         = t.closes > 0 ? t.spend / t.closes : null;
  t.roas        = t.spend  > 0 ? t.revenue / t.spend : null;
  return t;
}
