/**
 * Pure sales math — shared by the server query layer and the client
 * dashboard component. No imports from server-only modules, so this file is
 * safe to pull into a 'use client' component.
 *
 * Volume counts and revenue come straight from sales_metrics (per rep × day,
 * rolled up to month here). Every RATE and $-RATIO is *derived* from those raw
 * counts at display time — never stored — so a correction to a count instantly
 * fixes every percentage that depends on it.
 */

// ── Commission tiers ──────────────────────────────────────────────────────
// Thresholds are spec'd as fixed; the rates are editable in expense_config.
export const TIER_1_CAP = 10_000;
export const TIER_2_CAP = 25_000;
export const DEFAULT_TIERS: TierRates = { t1: 0.10, t2: 0.125, t3: 0.15 };

export interface TierRates { t1: number; t2: number; t3: number }

/**
 * Tiered commission on one rep's collected amount, per period.
 *   Tier 1: t1 up to $10,000
 *   Tier 2: t2 on $10,001–$25,000
 *   Tier 3: t3 above $25,000
 * Tiers reset per rep per period, so always feed this a single rep's collected
 * for a single period — never a pre-summed team total.
 */
export function tieredCommission(collected: number, t: TierRates): number {
  if (!Number.isFinite(collected) || collected <= 0) return 0;
  let comm = Math.min(collected, TIER_1_CAP) * t.t1;
  if (collected > TIER_1_CAP) {
    comm += (Math.min(collected, TIER_2_CAP) - TIER_1_CAP) * t.t2;
  }
  if (collected > TIER_2_CAP) {
    comm += (collected - TIER_2_CAP) * t.t3;
  }
  return comm;
}

// ── Raw metric carrier ─────────────────────────────────────────────────────
export interface RawMetrics {
  intro_calls:        number;
  live_intros:        number;
  offers_made:        number;
  deposits:           number;
  closes:             number;
  verbal_commitments: number;
  collected:          number;
  total_revenue:      number;
}

export function emptyRaw(): RawMetrics {
  return {
    intro_calls: 0, live_intros: 0, offers_made: 0, deposits: 0, closes: 0,
    verbal_commitments: 0, collected: 0, total_revenue: 0,
  };
}

/** Add `b` into `a` in place and return `a`. */
export function addRaw(a: RawMetrics, b: Partial<RawMetrics>): RawMetrics {
  a.intro_calls        += b.intro_calls        ?? 0;
  a.live_intros        += b.live_intros        ?? 0;
  a.offers_made        += b.offers_made        ?? 0;
  a.deposits           += b.deposits           ?? 0;
  a.closes             += b.closes             ?? 0;
  a.verbal_commitments += b.verbal_commitments ?? 0;
  a.collected          += b.collected          ?? 0;
  a.total_revenue      += b.total_revenue      ?? 0;
  return a;
}

/** Scale every field of a RawMetrics by `k` (used for the Avg/Rep row). */
export function scaleRaw(a: RawMetrics, k: number): RawMetrics {
  return {
    intro_calls:        a.intro_calls        * k,
    live_intros:        a.live_intros        * k,
    offers_made:        a.offers_made        * k,
    deposits:           a.deposits           * k,
    closes:             a.closes             * k,
    verbal_commitments: a.verbal_commitments * k,
    collected:          a.collected          * k,
    total_revenue:      a.total_revenue      * k,
  };
}

// ── Derived metrics ─────────────────────────────────────────────────────────
export interface DerivedRates {
  show_rate:          number | null;   // Live Intros ÷ Intro Calls
  offer_rate:         number | null;   // Offers ÷ Live Intros
  offer_commit_rate:  number | null;   // Verbal Commitments ÷ Live Intros
  offer_close_rate:   number | null;   // Closes ÷ Offers
  call_commit_rate:   number | null;   // Verbal Commitments ÷ Intro Calls
  call_close_rate:    number | null;   // Closes ÷ Intro Calls
  collected_pct:      number | null;   // Collected ÷ Total Revenue
  collected_per_call:  number | null;
  collected_per_offer: number | null;
  revenue_per_call:    number | null;
  revenue_per_offer:   number | null;
}

const div = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export function deriveRates(r: RawMetrics): DerivedRates {
  return {
    show_rate:           div(r.live_intros,        r.intro_calls),
    offer_rate:          div(r.offers_made,        r.live_intros),
    offer_commit_rate:   div(r.verbal_commitments, r.live_intros),
    offer_close_rate:    div(r.closes,             r.offers_made),
    call_commit_rate:    div(r.verbal_commitments, r.intro_calls),
    call_close_rate:     div(r.closes,             r.intro_calls),
    collected_pct:       div(r.collected,          r.total_revenue),
    collected_per_call:  div(r.collected,          r.intro_calls),
    collected_per_offer: div(r.collected,          r.offers_made),
    revenue_per_call:    div(r.total_revenue,      r.intro_calls),
    revenue_per_offer:   div(r.total_revenue,      r.offers_made),
  };
}

// ── Benchmarks for rate-column colour coding (green ≥ benchmark, red below) ──
// Sensible one-call-close defaults; tune later or wire to expense_config.
export const RATE_BENCHMARKS = {
  show_rate:         0.60,
  offer_rate:        0.70,
  offer_commit_rate: 0.50,
  offer_close_rate:  0.30,
  call_commit_rate:  0.40,
  call_close_rate:   0.20,
} as const;

export type RateKey = keyof typeof RATE_BENCHMARKS;

// ── Per-(rep × month) cell, as returned by loadSalesYear ─────────────────────
export interface RepMonthCell extends RawMetrics {
  rep_id:   string;
  rep_name: string;
  month:    number;   // 0 = January … 11 = December
}

export interface SalesYearData {
  year:  number;
  reps:  { rep_id: string; rep_name: string }[];
  cells: RepMonthCell[];
  tiers: TierRates;
}

export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** [start, end] month indices for each quarter, inclusive. */
export const QUARTERS: { label: string; months: number[] }[] = [
  { label: 'Q1', months: [0, 1, 2] },
  { label: 'Q2', months: [3, 4, 5] },
  { label: 'Q3', months: [6, 7, 8] },
  { label: 'Q4', months: [9, 10, 11] },
];
