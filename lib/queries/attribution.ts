/**
 * Attribution aggregation across meta_ad_performance + page_view_events +
 * ghl_pipeline_events. Joined in JS by UTM keys.
 *
 * The dashboard table can drill on 4 levels: source | campaign | medium | ad.
 * "ad" groups by (campaign, ad_name); "source" groups by utm_source only.
 *
 * Returns one row per group with: spend, page_views, leads, booked, shown,
 * closes, revenue, CPL, CAC, ROAS — all derived at query time.
 */

import { maybeServiceClient } from '@/lib/supabase/server';

export type DrillLevel = 'source' | 'campaign' | 'medium' | 'ad';

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

function bucketKey(level: DrillLevel, row: any): { key: string; label: string } {
  switch (level) {
    case 'source':   return { key: row.utm_source   || '(direct)',   label: row.utm_source   || '(direct)' };
    case 'medium':   return { key: row.utm_medium   || '(none)',     label: row.utm_medium   || '(none)' };
    case 'campaign': return { key: row.utm_campaign || '(no campaign)', label: row.utm_campaign || '(no campaign)' };
    case 'ad':       return {
      key:   `${row.utm_campaign || ''}|${row.utm_content || row.ad_name || ''}`,
      label: row.utm_content || row.ad_name || '(no ad)',
    };
  }
}

export async function aggregateAttribution(
  level: DrillLevel,
  fromISO: string,
  toISO: string
): Promise<AttributionRow[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];

  // toISO is inclusive — bump end-of-day for *_at comparisons
  const toEnd = `${toISO}T23:59:59.999Z`;

  // Run independent reads in parallel
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
  function bucket(key: string, label: string): AttributionRow {
    let b = bucketsMap.get(key);
    if (!b) { b = { ...EMPTY, key, label }; bucketsMap.set(key, b); }
    return b;
  }

  // Spend rows
  for (const r of spendRes.data ?? []) {
    const rr = r as any;
    // Spend tables don't carry utm_source/medium by default — derive from campaign/ad
    // naming or assume "meta" for source if we have any meta spend.
    const synthetic = {
      utm_source:   'meta',
      utm_medium:   'paid-social',
      utm_campaign: rr.campaign_name,
      utm_content:  rr.ad_name,
      ad_name:      rr.ad_name,
    };
    const { key, label } = bucketKey(level, synthetic);
    const b = bucket(key, label);
    b.spend += Number(rr.spend) || 0;
  }

  // Page views
  for (const r of pvRes.data ?? []) {
    const { key, label } = bucketKey(level, r);
    const b = bucket(key, label);
    b.page_views += 1;
  }

  // Pipeline events → leads/booked/shown/closes/revenue
  for (const r of evRes.data ?? []) {
    const rr = r as any;
    const { key, label } = bucketKey(level, rr);
    const b = bucket(key, label);
    switch (rr.event_name) {
      case 'Lead':              b.leads  += 1; break;
      case 'AppointmentBooked': b.booked += 1; break;
      case 'AppointmentShown':  b.shown  += 1; break;
      case 'Purchase':          b.closes += 1; b.revenue += Number(rr.deal_value) || 0; break;
    }
  }

  // Derived
  const out = Array.from(bucketsMap.values()).map((b) => ({
    ...b,
    cpl:         b.leads  > 0 ? b.spend / b.leads  : null,
    cost_booked: b.booked > 0 ? b.spend / b.booked : null,
    cost_shown:  b.shown  > 0 ? b.spend / b.shown  : null,
    cac:         b.closes > 0 ? b.spend / b.closes : null,
    roas:        b.spend  > 0 ? b.revenue / b.spend : null,
  }));

  // Sort by spend desc
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
