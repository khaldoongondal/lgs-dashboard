/**
 * Sales-pipeline rollups per rep in a date range.
 *
 * Source: public.sales_metrics (populated by /api/cron/sales-aggregate from
 * raw ghl_pipeline_events). Rates derived at query time so a count correction
 * in sales_metrics immediately reflects in every percentage on the dashboard.
 *
 * Commission tiers come from public.expense_config (rates are editable
 * without a code change). Thresholds — $10k and $25k — are spec'd as fixed.
 */

import { maybeServiceClient } from '@/lib/supabase/server';

// ── Tier thresholds (spec'd as fixed; rates are editable) ──────────────
const TIER_1_CAP = 10_000;
const TIER_2_CAP = 25_000;

// Defaults used if expense_config is missing the rows.
const DEFAULT_TIERS = { t1: 0.10, t2: 0.125, t3: 0.15 };

export interface RepRow {
  rep_id:             string;
  rep_name:           string;
  // Volume
  intro_calls:        number;
  live_intros:        number;
  offers_made:        number;
  deposits:           number;
  closes:             number;
  verbal_commitments: number;
  // Revenue
  collected:          number;
  total_revenue:      number;
  // Commission (derived from collected + tiers)
  commission:         number;
  // Derived rates
  show_rate:           number | null;
  offer_rate:          number | null;
  close_rate:          number | null;
  call_to_close:       number | null;
  call_commitment:     number | null;
  // Derived $ ratios
  collected_per_call:  number | null;
  collected_per_offer: number | null;
  revenue_per_call:    number | null;
  revenue_per_offer:   number | null;
}

export interface SalesSummary {
  rows:  RepRow[];
  total: RepRow;
  avg:   RepRow;
  tiers: { t1: number; t2: number; t3: number };
}

interface TierRates { t1: number; t2: number; t3: number }

async function loadTierRates(sb: ReturnType<typeof maybeServiceClient>): Promise<TierRates> {
  if (!sb) return DEFAULT_TIERS;
  const { data } = await sb
    .from('expense_config')
    .select('key, value_pct')
    .in('key', ['commission_tier_1_pct', 'commission_tier_2_pct', 'commission_tier_3_pct'])
    .eq('scope', 'default');

  const out = { ...DEFAULT_TIERS };
  for (const r of data ?? []) {
    const rr = r as any;
    const v = rr.value_pct != null ? Number(rr.value_pct) : null;
    if (v === null || !Number.isFinite(v)) continue;
    if (rr.key === 'commission_tier_1_pct') out.t1 = v;
    if (rr.key === 'commission_tier_2_pct') out.t2 = v;
    if (rr.key === 'commission_tier_3_pct') out.t3 = v;
  }
  return out;
}

/**
 * Compute tiered commission for one rep's collected amount.
 * Tier 1: 10% up to $10,000
 * Tier 2: 12.5% on $10,001-$25,000
 * Tier 3: 15% above $25,000
 */
function tieredCommission(collected: number, t: TierRates): number {
  if (collected <= 0) return 0;
  let comm = 0;
  if (collected > 0) {
    const portion1 = Math.min(collected, TIER_1_CAP);
    comm += portion1 * t.t1;
  }
  if (collected > TIER_1_CAP) {
    const portion2 = Math.min(collected, TIER_2_CAP) - TIER_1_CAP;
    if (portion2 > 0) comm += portion2 * t.t2;
  }
  if (collected > TIER_2_CAP) {
    const portion3 = collected - TIER_2_CAP;
    comm += portion3 * t.t3;
  }
  return comm;
}

function withRates(
  r: Omit<RepRow,
    | 'show_rate' | 'offer_rate' | 'close_rate' | 'call_to_close' | 'call_commitment'
    | 'collected_per_call' | 'collected_per_offer'
    | 'revenue_per_call'   | 'revenue_per_offer'
    | 'commission'
  >,
  tiers: TierRates,
): RepRow {
  return {
    ...r,
    show_rate:           r.intro_calls > 0 ? r.live_intros / r.intro_calls : null,
    offer_rate:          r.live_intros > 0 ? r.offers_made / r.live_intros : null,
    close_rate:          r.offers_made > 0 ? r.closes      / r.offers_made : null,
    call_to_close:       r.intro_calls > 0 ? r.closes      / r.intro_calls : null,
    call_commitment:     r.live_intros > 0 ? r.verbal_commitments / r.live_intros : null,
    collected_per_call:  r.intro_calls > 0 ? r.collected     / r.intro_calls : null,
    collected_per_offer: r.offers_made > 0 ? r.collected     / r.offers_made : null,
    revenue_per_call:    r.intro_calls > 0 ? r.total_revenue / r.intro_calls : null,
    revenue_per_offer:   r.offers_made > 0 ? r.total_revenue / r.offers_made : null,
    commission:          tieredCommission(r.collected, tiers),
  };
}

export async function loadSalesSummary(fromISO: string, toISO: string): Promise<SalesSummary> {
  const sb = maybeServiceClient();
  if (!sb) return emptySummary(DEFAULT_TIERS);

  const tiers = await loadTierRates(sb);

  const { data, error } = await sb
    .from('sales_metrics')
    .select('*')
    .gte('date', fromISO)
    .lte('date', toISO);

  if (error) {
    console.warn('[sales] supabase error:', error.message);
    return emptySummary(tiers);
  }

  // Group by rep
  const byRep = new Map<string, Omit<RepRow,
    | 'show_rate' | 'offer_rate' | 'close_rate' | 'call_to_close' | 'call_commitment'
    | 'collected_per_call' | 'collected_per_offer'
    | 'revenue_per_call'   | 'revenue_per_offer'
    | 'commission'
  >>();

  for (const r of data ?? []) {
    const rr = r as any;
    const key = rr.rep_id ?? '(unassigned)';
    let existing = byRep.get(key);
    if (!existing) {
      existing = {
        rep_id:             key,
        rep_name:           rr.rep_name || key,
        intro_calls:        0, live_intros: 0, offers_made: 0, deposits: 0, closes: 0,
        verbal_commitments: 0,
        collected:          0, total_revenue: 0,
      };
    }
    existing.intro_calls        += Number(rr.intro_calls)        || 0;
    existing.live_intros        += Number(rr.live_intros)        || 0;
    existing.offers_made        += Number(rr.offers_made)        || 0;
    existing.deposits           += Number(rr.deposits)           || 0;
    existing.closes             += Number(rr.closes)             || 0;
    existing.verbal_commitments += Number(rr.verbal_commitments) || 0;
    existing.collected          += Number(rr.collected)          || 0;
    existing.total_revenue      += Number(rr.total_revenue)      || 0;
    byRep.set(key, existing);
  }

  const rows = Array.from(byRep.values())
    .map((r) => withRates(r, tiers))
    .sort((a, b) => b.collected - a.collected);

  const sum = rows.reduce(
    (acc, r) => ({
      intro_calls:        acc.intro_calls        + r.intro_calls,
      live_intros:        acc.live_intros        + r.live_intros,
      offers_made:        acc.offers_made        + r.offers_made,
      deposits:           acc.deposits           + r.deposits,
      closes:             acc.closes             + r.closes,
      verbal_commitments: acc.verbal_commitments + r.verbal_commitments,
      collected:          acc.collected          + r.collected,
      total_revenue:      acc.total_revenue      + r.total_revenue,
    }),
    { intro_calls: 0, live_intros: 0, offers_made: 0, deposits: 0, closes: 0,
      verbal_commitments: 0, collected: 0, total_revenue: 0 },
  );

  // Team Total — commission is sum of per-rep commissions (because the tiers
  // reset per rep). Replace withRates's commission output with the per-rep sum.
  const teamCommissionSum = rows.reduce((s, r) => s + r.commission, 0);
  const total = {
    ...withRates({ rep_id: '__total', rep_name: 'Team Total', ...sum }, tiers),
    commission: teamCommissionSum,
  };

  const n = Math.max(rows.length, 1);
  const avg = withRates({
    rep_id:             '__avg',
    rep_name:           'Team Avg / Rep',
    intro_calls:        sum.intro_calls        / n,
    live_intros:        sum.live_intros        / n,
    offers_made:        sum.offers_made        / n,
    deposits:           sum.deposits           / n,
    closes:             sum.closes             / n,
    verbal_commitments: sum.verbal_commitments / n,
    collected:          sum.collected          / n,
    total_revenue:      sum.total_revenue      / n,
  }, tiers);

  return { rows, total, avg, tiers };
}

function emptySummary(tiers: TierRates): SalesSummary {
  const zero = withRates({
    rep_id: '', rep_name: '',
    intro_calls: 0, live_intros: 0, offers_made: 0, deposits: 0, closes: 0,
    verbal_commitments: 0,
    collected: 0, total_revenue: 0,
  }, tiers);
  return {
    rows:  [],
    total: { ...zero, rep_id: '__total', rep_name: 'Team Total' },
    avg:   { ...zero, rep_id: '__avg',   rep_name: 'Team Avg / Rep' },
    tiers,
  };
}
