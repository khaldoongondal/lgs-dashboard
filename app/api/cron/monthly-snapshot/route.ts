/**
 * GET /api/cron/monthly-snapshot — compute monthly_kpi_snapshots rows from
 * raw data (clients + meta_ad_performance + sales_metrics + expense_config).
 *
 * Idempotent on (month, snapshot_type='actual') — safe to re-run after
 * corrections in any source table.
 *
 * Auth: CRON_SECRET (Bearer header or ?secret=).
 *
 * Query params:
 *   - month         single ISO month (e.g. 2026-05) — defaults to last month
 *   - since,until   range mode (ISO months) — backfills each month inclusive
 *
 * Note: Vercel Hobby caps cron entries at 2/day. Meta-spend and sales-aggregate
 * already fill those slots — call this endpoint manually until you upgrade.
 */
import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const fromQuery  = url.searchParams.get('secret');
  const fromHeader = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return fromQuery === secret || fromHeader === secret;
}

function firstOfMonth(year: number, month1Based: number): string {
  return `${year}-${String(month1Based).padStart(2, '0')}-01`;
}

function* eachMonthInclusive(sinceYM: string, untilYM: string): Generator<{ year: number; month: number }> {
  const [sy, sm] = sinceYM.split('-').map(Number);
  const [ey, em] = untilYM.split('-').map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    yield { year: y, month: m };
    m++;
    if (m > 12) { m = 1; y++; }
  }
}

function monthBounds(year: number, month: number): { startISO: string; endISO: string; nextStartISO: string } {
  const start = `${firstOfMonth(year, month)}T00:00:00.000Z`;
  const next  = month === 12 ? `${year + 1}-01-01T00:00:00.000Z` : `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00.000Z`;
  const end   = new Date(new Date(next).getTime() - 1).toISOString();
  return { startISO: start, endISO: end, nextStartISO: next };
}

interface ExpenseDefaults {
  tech_cost:                number;
  setup_cost_per_customer:  number;
  setter_cost_per_customer: number;
  csm_cost_per_active:      number;
  kd_profit_share_pct:      number;
  arpu:                     number;
}

async function loadExpenseDefaults(sb: ReturnType<typeof serviceClient>): Promise<ExpenseDefaults> {
  const defaults: ExpenseDefaults = {
    tech_cost:                1000,
    setup_cost_per_customer:  50,
    setter_cost_per_customer: 25,
    csm_cost_per_active:      20,
    kd_profit_share_pct:      0.30,
    arpu:                     297,
  };
  const { data } = await sb
    .from('expense_config')
    .select('key, value_numeric, value_pct')
    .eq('scope', 'default')
    .in('key', Object.keys(defaults));
  for (const r of data ?? []) {
    const rr = r as any;
    const v = rr.value_numeric != null ? Number(rr.value_numeric) : (rr.value_pct != null ? Number(rr.value_pct) : NaN);
    if (Number.isFinite(v) && rr.key in defaults) {
      (defaults as any)[rr.key] = v;
    }
  }
  return defaults;
}

interface MonthlyResult {
  month:               string;
  active_subscribers:  number;
  new_subscribers:     number;
  churned_subscribers: number;
  churn_rate:          number | null;
  mrr:                 number;
  arpu:                number | null;
  ad_spend:            number;
  cac:                 number | null;
  new_customers:       number;
  revenue:             number;
  tech_cost:           number;
  setup_cost_total:    number;
  setter_cost_total:   number;
  csm_cost_total:      number;
  commission_total:    number;
  total_expenses:      number;
  profit_before_kd:    number;
  kd_share:            number;
  net_profit:          number;
  avg_tenure_months:   number | null;
  ltv:                 number | null;
  ltv_cac_ratio:       number | null;
  payback_months:      number | null;
}

async function snapshotMonth(
  sb: ReturnType<typeof serviceClient>,
  year: number,
  month: number,
  defaults: ExpenseDefaults,
): Promise<MonthlyResult> {
  const { startISO, endISO, nextStartISO } = monthBounds(year, month);
  const monthIso = firstOfMonth(year, month);

  // ── Clients aggregation ──────────────────────────────────────────────
  const [allClientsRes, spendRes, salesRes] = await Promise.all([
    sb.from('clients').select('id, status, started_at, churned_at, mrr_value, tenure_months'),
    sb.from('meta_ad_performance')
      .select('date, spend')
      .gte('date', startISO.slice(0, 10))
      .lte('date', endISO.slice(0, 10)),
    sb.from('sales_metrics')
      .select('date, collected, commission_paid')
      .gte('date', startISO.slice(0, 10))
      .lte('date', endISO.slice(0, 10)),
  ]);

  const clients = (allClientsRes.data ?? []) as any[];

  // Active = started before next month AND (not churned OR churned after this month ends)
  let active = 0, mrr = 0;
  let newSubs = 0;
  let churnedSubs = 0;
  let activeAtStart = 0;
  let tenureSum = 0, tenureN = 0;
  for (const c of clients) {
    const start = c.started_at ? new Date(c.started_at).getTime() : null;
    const churn = c.churned_at ? new Date(c.churned_at).getTime() : null;
    const inStart   = start !== null && start < new Date(nextStartISO).getTime();
    const aliveEnd  = inStart && (churn === null || churn >= new Date(nextStartISO).getTime());
    const aliveStart = inStart && start! < new Date(startISO).getTime() && (churn === null || churn >= new Date(startISO).getTime());
    if (aliveEnd) {
      active++;
      mrr += Number(c.mrr_value) || 0;
    }
    if (aliveStart) activeAtStart++;
    if (start !== null && start >= new Date(startISO).getTime() && start < new Date(nextStartISO).getTime()) newSubs++;
    if (churn !== null && churn >= new Date(startISO).getTime() && churn < new Date(nextStartISO).getTime()) churnedSubs++;

    if (c.tenure_months != null) {
      const t = Number(c.tenure_months);
      if (Number.isFinite(t)) { tenureSum += t; tenureN++; }
    }
  }

  // ── Ad spend ─────────────────────────────────────────────────────────
  let adSpend = 0;
  for (const r of spendRes.data ?? []) {
    adSpend += Number((r as any).spend) || 0;
  }

  // ── Sales: collected + commission ───────────────────────────────────
  let collected = 0, commission = 0;
  for (const r of salesRes.data ?? []) {
    collected  += Number((r as any).collected)       || 0;
    commission += Number((r as any).commission_paid) || 0;
  }

  // ── Derived ──────────────────────────────────────────────────────────
  const churnRate    = activeAtStart > 0 ? churnedSubs / activeAtStart : null;
  const arpu         = active       > 0 ? mrr        / active : (defaults.arpu || null);
  const cac          = newSubs      > 0 ? adSpend    / newSubs : null;
  const avgTenure    = tenureN      > 0 ? tenureSum  / tenureN : null;
  // Active-client LTV uses configured ARPU * avg tenure; falls back to mrr * 12 when no churned data exists.
  const ltvBasis     = arpu ?? defaults.arpu;
  const ltv          = avgTenure != null ? avgTenure * ltvBasis : ltvBasis * 12;
  const ltvCacRatio  = cac && ltv ? ltv / cac : null;
  const paybackMonths = cac && arpu ? cac / arpu : null;

  // Revenue: use collected from sales_metrics; fall back to mrr if collected==0
  const revenue = collected > 0 ? collected : mrr;

  const setupCostTotal  = defaults.setup_cost_per_customer  * newSubs;
  const setterCostTotal = defaults.setter_cost_per_customer * newSubs;
  const csmCostTotal    = defaults.csm_cost_per_active      * active;
  const techCost        = defaults.tech_cost;
  const commissionTotal = commission;
  const totalExpenses   = adSpend + techCost + setupCostTotal + setterCostTotal + csmCostTotal + commissionTotal;
  const profitBeforeKd  = revenue - totalExpenses;
  const kdShare         = profitBeforeKd > 0 ? profitBeforeKd * defaults.kd_profit_share_pct : 0;
  const netProfit       = profitBeforeKd - kdShare;

  return {
    month:               monthIso,
    active_subscribers:  active,
    new_subscribers:     newSubs,
    churned_subscribers: churnedSubs,
    churn_rate:          churnRate,
    mrr,
    arpu:                arpu,
    ad_spend:            adSpend,
    cac:                 cac,
    new_customers:       newSubs,
    revenue,
    tech_cost:           techCost,
    setup_cost_total:    setupCostTotal,
    setter_cost_total:   setterCostTotal,
    csm_cost_total:      csmCostTotal,
    commission_total:    commissionTotal,
    total_expenses:      totalExpenses,
    profit_before_kd:    profitBeforeKd,
    kd_share:            kdShare,
    net_profit:          netProfit,
    avg_tenure_months:   avgTenure,
    ltv,
    ltv_cac_ratio:       ltvCacRatio,
    payback_months:      paybackMonths,
  };
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const monthParam = url.searchParams.get('month');     // "2026-05"
  const sinceParam = url.searchParams.get('since');     // "2026-01"
  const untilParam = url.searchParams.get('until');     // "2026-05"

  let months: { year: number; month: number }[];
  if (sinceParam && untilParam) {
    months = Array.from(eachMonthInclusive(sinceParam, untilParam));
  } else if (monthParam) {
    const [y, m] = monthParam.split('-').map(Number);
    months = [{ year: y, month: m }];
  } else {
    // Default: previous full month
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    months = [{ year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 }];
  }
  if (months.length > 36) {
    return NextResponse.json({ error: 'range_too_large', max_months: 36 }, { status: 400 });
  }

  const sb = serviceClient();
  const defaults = await loadExpenseDefaults(sb);

  const results: MonthlyResult[] = [];
  for (const { year, month } of months) {
    results.push(await snapshotMonth(sb, year, month, defaults));
  }

  // Upsert each row. The table doesn't have a unique constraint on
  // (month, snapshot_type) by default — delete existing actual rows for
  // these months first to keep the data clean.
  const monthIsos = results.map((r) => r.month);
  await sb.from('monthly_kpi_snapshots')
    .delete()
    .eq('snapshot_type', 'actual')
    .in('month', monthIsos);

  const rows = results.map((r) => ({
    ...r,
    snapshot_type: 'actual' as const,
    computed_at:   new Date().toISOString(),
  }));
  const { error } = await sb.from('monthly_kpi_snapshots').insert(rows);
  if (error) {
    return NextResponse.json({ error: 'db_write_error', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok:       true,
    written:  rows.length,
    months:   monthIsos,
  });
}
