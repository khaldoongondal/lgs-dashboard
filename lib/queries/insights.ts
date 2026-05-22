/**
 * Cross-layer insight queries — answers the spec's four killer questions:
 *
 *   1. Which Meta ad produces clients who close at the highest rate?
 *      → adByCloseRate(): ad × (leads, closes, close_rate, revenue)
 *
 *   2. Which rep converts best from paid social vs organic?
 *      → repBySource(): rep × source × (leads, closes, close_rate)
 *
 *   3. Which campaign drives clients with the longest tenure (highest LTV)?
 *      → campaignByLTV(): campaign × (clients, total_mrr, avg_tenure, ltv)
 *
 *   4. Where in the funnel are leads from Campaign A dropping off vs B?
 *      → campaignFunnel(): per-campaign funnel waterfall
 *
 * Joins are done in JS rather than via PostgREST joins so we can layer the
 * UTM-cascade (event UTMs → contact UTMs) the dashboard already uses.
 */

import { maybeServiceClient } from '@/lib/supabase/server';

// ─────────────────────────────────────────────────────────────────────
// 1. Ad × Close Rate
// ─────────────────────────────────────────────────────────────────────

export interface AdCloseRow {
  ad_name:     string;
  campaign:    string;
  leads:       number;
  booked:      number;
  shown:       number;
  closes:      number;
  revenue:     number;
  spend:       number;
  close_rate:  number | null;   // closes / leads
  cpl:         number | null;
  cac:         number | null;
  roas:        number | null;
}

export interface InsightFilter {
  source?:   string;
  campaign?: string;
}

function matchUtm(rowSource: string | null, rowCampaign: string | null, f: InsightFilter): boolean {
  if (f.source && (rowSource || '(direct)') !== f.source) return false;
  if (f.campaign && (rowCampaign || '(no campaign)') !== f.campaign) return false;
  return true;
}

export async function adByCloseRate(fromISO: string, toISO: string, filter: InsightFilter = {}): Promise<AdCloseRow[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];
  const toEnd = `${toISO}T23:59:59.999Z`;

  const [evRes, spendRes, contactsRes] = await Promise.all([
    sb.from('ghl_pipeline_events')
      .select('event_name, deal_value, utm_campaign, utm_content, contact_id')
      .gte('event_time', fromISO).lte('event_time', toEnd),
    sb.from('meta_ad_performance')
      .select('campaign_name, ad_name, spend')
      .gte('date', fromISO).lte('date', toISO),
    sb.from('ghl_contacts')
      .select('id, utm_campaign, utm_content'),
  ]);
  if (evRes.error || spendRes.error || contactsRes.error) return [];

  // contact_id → fallback UTMs
  const contactUtms = new Map<number, { campaign: string | null; content: string | null }>();
  for (const c of contactsRes.data ?? []) {
    const cc = c as any;
    contactUtms.set(cc.id, { campaign: cc.utm_campaign, content: cc.utm_content });
  }

  // Bucket by (campaign, ad_name)
  const map = new Map<string, AdCloseRow>();
  function bucket(campaign: string, ad_name: string): AdCloseRow {
    const k = `${campaign}|${ad_name}`;
    let b = map.get(k);
    if (!b) {
      b = {
        campaign, ad_name,
        leads: 0, booked: 0, shown: 0, closes: 0, revenue: 0, spend: 0,
        close_rate: null, cpl: null, cac: null, roas: null,
      };
      map.set(k, b);
    }
    return b;
  }

  // Spend
  for (const r of spendRes.data ?? []) {
    const rr = r as any;
    const campaign = rr.campaign_name || '(no campaign)';
    const ad_name  = rr.ad_name       || '(no ad)';
    // For ad spend we treat utm_source as 'meta' (it's a Meta spend row).
    if (!matchUtm('meta', campaign, filter)) continue;
    bucket(campaign, ad_name).spend += Number(rr.spend) || 0;
  }

  // Pipeline events
  for (const r of evRes.data ?? []) {
    const rr = r as any;
    const cu = rr.contact_id ? contactUtms.get(rr.contact_id) : null;
    const utm_source = rr.utm_source || (rr.contact_id ? (cu as any)?.source : null);
    const campaign = rr.utm_campaign || cu?.campaign || '(no campaign)';
    const ad_name  = rr.utm_content  || cu?.content  || '(no ad)';
    if (!matchUtm(utm_source || null, campaign, filter)) continue;
    const b = bucket(campaign, ad_name);
    switch (rr.event_name) {
      case 'Lead':              b.leads  += 1; break;
      case 'AppointmentBooked': b.booked += 1; break;
      case 'AppointmentShown':  b.shown  += 1; break;
      case 'Purchase':          b.closes += 1; b.revenue += Number(rr.deal_value) || 0; break;
    }
  }

  return Array.from(map.values())
    .map((b) => ({
      ...b,
      close_rate: b.leads  > 0 ? b.closes  / b.leads  : null,
      cpl:        b.leads  > 0 ? b.spend   / b.leads  : null,
      cac:        b.closes > 0 ? b.spend   / b.closes : null,
      roas:       b.spend  > 0 ? b.revenue / b.spend  : null,
    }))
    .filter((r) => r.leads > 0 || r.spend > 0)
    .sort((a, b) => (b.close_rate ?? 0) - (a.close_rate ?? 0));
}

// ─────────────────────────────────────────────────────────────────────
// 2. Rep × Source
// ─────────────────────────────────────────────────────────────────────

export interface RepSourceRow {
  rep_name:    string;
  source:      string;
  leads:       number;
  closes:      number;
  revenue:     number;
  close_rate:  number | null;
}

export async function repBySource(fromISO: string, toISO: string, filter: InsightFilter = {}): Promise<RepSourceRow[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];
  const toEnd = `${toISO}T23:59:59.999Z`;

  const [evRes, contactsRes] = await Promise.all([
    sb.from('ghl_pipeline_events')
      .select('event_name, deal_value, rep_name, utm_source, contact_id')
      .gte('event_time', fromISO).lte('event_time', toEnd),
    sb.from('ghl_contacts').select('id, utm_source'),
  ]);
  if (evRes.error || contactsRes.error) return [];

  const contactSrc = new Map<number, string | null>();
  for (const c of contactsRes.data ?? []) {
    const cc = c as any;
    contactSrc.set(cc.id, cc.utm_source);
  }

  const map = new Map<string, RepSourceRow>();
  function bucket(rep_name: string, source: string): RepSourceRow {
    const k = `${rep_name}|${source}`;
    let b = map.get(k);
    if (!b) {
      b = { rep_name, source, leads: 0, closes: 0, revenue: 0, close_rate: null };
      map.set(k, b);
    }
    return b;
  }

  for (const r of evRes.data ?? []) {
    const rr = r as any;
    const rep_name = rr.rep_name || '(unassigned)';
    const cs = rr.contact_id ? contactSrc.get(rr.contact_id) : null;
    const source = rr.utm_source || cs || '(direct)';
    if (!matchUtm(source, null, filter)) continue;
    const b = bucket(rep_name, source);
    if (rr.event_name === 'Lead')     b.leads  += 1;
    if (rr.event_name === 'Purchase') { b.closes += 1; b.revenue += Number(rr.deal_value) || 0; }
  }

  return Array.from(map.values())
    .map((b) => ({ ...b, close_rate: b.leads > 0 ? b.closes / b.leads : null }))
    .sort((a, b) => (b.close_rate ?? 0) - (a.close_rate ?? 0));
}

// ─────────────────────────────────────────────────────────────────────
// 3. Campaign × LTV  (needs clients table populated)
// ─────────────────────────────────────────────────────────────────────

export interface CampaignLtvRow {
  campaign:        string;
  clients:         number;
  active_clients:  number;
  total_mrr:       number;
  avg_tenure:      number | null;
  avg_ltv:         number | null;
}

export async function campaignByLTV(): Promise<CampaignLtvRow[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];

  const { data, error } = await sb
    .from('clients')
    .select('attributed_campaign, status, mrr_value, tenure_months');
  if (error || !data) return [];

  const map = new Map<string, CampaignLtvRow>();
  for (const c of data) {
    const cc = c as any;
    const campaign = cc.attributed_campaign || '(no campaign)';
    let b = map.get(campaign);
    if (!b) {
      b = { campaign, clients: 0, active_clients: 0, total_mrr: 0, avg_tenure: null, avg_ltv: null };
      map.set(campaign, b);
    }
    b.clients++;
    if (cc.status === 'active') b.active_clients++;
    b.total_mrr += Number(cc.mrr_value) || 0;
  }

  // Compute averages
  for (const [campaign, b] of map) {
    const rows = data.filter((c: any) => (c.attributed_campaign || '(no campaign)') === campaign);
    const tenures = rows.map((c: any) => Number(c.tenure_months)).filter((v) => Number.isFinite(v));
    b.avg_tenure = tenures.length > 0 ? tenures.reduce((s, v) => s + v, 0) / tenures.length : null;
    const ltvs = rows.map((c: any) => {
      const t = Number(c.tenure_months);
      const m = Number(c.mrr_value);
      return Number.isFinite(t) && Number.isFinite(m) ? t * m : null;
    }).filter((v): v is number => v !== null);
    b.avg_ltv = ltvs.length > 0 ? ltvs.reduce((s, v) => s + v, 0) / ltvs.length : null;
  }

  return Array.from(map.values()).sort((a, b) => (b.avg_ltv ?? 0) - (a.avg_ltv ?? 0));
}

// ─────────────────────────────────────────────────────────────────────
// 4. Campaign-by-campaign funnel comparison
// ─────────────────────────────────────────────────────────────────────

export interface CampaignFunnelRow {
  campaign:      string;
  leads:         number;
  booked:        number;
  shown:         number;
  closes:        number;
  show_rate:     number | null;     // shown / booked
  close_rate:    number | null;     // closes / leads
  booking_rate:  number | null;     // booked / leads
}

export async function campaignFunnel(fromISO: string, toISO: string, filter: InsightFilter = {}): Promise<CampaignFunnelRow[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];
  const toEnd = `${toISO}T23:59:59.999Z`;

  const [evRes, contactsRes] = await Promise.all([
    sb.from('ghl_pipeline_events')
      .select('event_name, utm_campaign, contact_id')
      .gte('event_time', fromISO).lte('event_time', toEnd),
    sb.from('ghl_contacts').select('id, utm_campaign'),
  ]);
  if (evRes.error || contactsRes.error) return [];

  const contactCampaign = new Map<number, string | null>();
  for (const c of contactsRes.data ?? []) {
    const cc = c as any;
    contactCampaign.set(cc.id, cc.utm_campaign);
  }

  const map = new Map<string, CampaignFunnelRow>();
  function bucket(campaign: string): CampaignFunnelRow {
    let b = map.get(campaign);
    if (!b) {
      b = {
        campaign, leads: 0, booked: 0, shown: 0, closes: 0,
        show_rate: null, close_rate: null, booking_rate: null,
      };
      map.set(campaign, b);
    }
    return b;
  }

  for (const r of evRes.data ?? []) {
    const rr = r as any;
    const cu = rr.contact_id ? contactCampaign.get(rr.contact_id) : null;
    const campaign = rr.utm_campaign || cu || '(no campaign)';
    if (filter.campaign && campaign !== filter.campaign) continue;
    if (filter.source) {
      // source filter requires we also know the rep's source; skip when missing
      if ((rr.utm_source || null) !== filter.source) continue;
    }
    const b = bucket(campaign);
    if (rr.event_name === 'Lead')              b.leads  += 1;
    if (rr.event_name === 'AppointmentBooked') b.booked += 1;
    if (rr.event_name === 'AppointmentShown')  b.shown  += 1;
    if (rr.event_name === 'Purchase')          b.closes += 1;
  }

  return Array.from(map.values())
    .map((b) => ({
      ...b,
      booking_rate: b.leads  > 0 ? b.booked / b.leads  : null,
      show_rate:    b.booked > 0 ? b.shown  / b.booked : null,
      close_rate:   b.leads  > 0 ? b.closes / b.leads  : null,
    }))
    .sort((a, b) => b.leads - a.leads);
}
