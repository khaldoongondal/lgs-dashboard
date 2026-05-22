/**
 * Financials queries — monthly P&L rows + client roll-ups.
 *
 * For v1 the page reads from monthly_kpi_snapshots (actual rows only). If
 * the table is empty we fall back to deriving live values from clients +
 * expense_config + sales_metrics for the current month.
 */

import { maybeServiceClient } from '@/lib/supabase/server';

export interface MonthSnapshot {
  month:               string;       // YYYY-MM-DD (first of month)
  mrr:                 number | null;
  active_subscribers:  number | null;
  new_subscribers:     number | null;
  churned_subscribers: number | null;
  churn_rate:          number | null;
  ad_spend:            number | null;
  cac:                 number | null;
  total_expenses:      number | null;
  profit_before_kd:    number | null;
  kd_share:            number | null;
  net_profit:          number | null;
  ltv:                 number | null;
  ltv_cac_ratio:       number | null;
  payback_months:      number | null;
}

export async function loadMonthlySnapshots(fromISO: string, toISO: string): Promise<MonthSnapshot[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];

  const { data, error } = await sb
    .from('monthly_kpi_snapshots')
    .select('*')
    .eq('snapshot_type', 'actual')
    .gte('month', firstOfMonth(fromISO))
    .lte('month', firstOfMonth(toISO))
    .order('month', { ascending: false });

  if (error) {
    console.warn('[financials] supabase error:', error.message);
    return [];
  }
  return (data ?? []) as unknown as MonthSnapshot[];
}

export async function loadClientCounts(): Promise<{ active: number; at_risk: number; churned: number }> {
  const sb = maybeServiceClient();
  if (!sb) return { active: 0, at_risk: 0, churned: 0 };

  const { data, error } = await sb.from('clients').select('status');
  if (error) return { active: 0, at_risk: 0, churned: 0 };

  let active = 0, at_risk = 0, churned = 0;
  for (const r of data ?? []) {
    const s = (r as any).status;
    if (s === 'active')  active++;
    else if (s === 'at_risk')  at_risk++;
    else if (s === 'churned')  churned++;
  }
  return { active, at_risk, churned };
}

/**
 * Live-derive headline financials for the current period when no monthly
 * snapshot exists yet. Mirrors the logic in /api/cron/monthly-snapshot
 * but returns just enough fields for the StatCards.
 */
export async function deriveCurrentSnapshot(fromISO: string, toISO: string): Promise<MonthSnapshot | null> {
  const sb = maybeServiceClient();
  if (!sb) return null;

  const [clientsRes, spendRes, salesRes, expRes] = await Promise.all([
    sb.from('clients').select('status, mrr_value, started_at, churned_at, tenure_months'),
    sb.from('meta_ad_performance').select('spend').gte('date', fromISO).lte('date', toISO),
    sb.from('sales_metrics').select('collected, commission_paid').gte('date', fromISO).lte('date', toISO),
    sb.from('expense_config')
      .select('key, value_numeric, value_pct')
      .eq('scope', 'default')
      .in('key', ['tech_cost', 'setup_cost_per_customer', 'setter_cost_per_customer',
                  'csm_cost_per_active', 'kd_profit_share_pct', 'arpu']),
  ]);

  const defaults: Record<string, number> = {
    tech_cost: 1000, setup_cost_per_customer: 50, setter_cost_per_customer: 25,
    csm_cost_per_active: 20, kd_profit_share_pct: 0.30, arpu: 297,
  };
  for (const r of expRes.data ?? []) {
    const rr = r as any;
    const v = rr.value_numeric != null ? Number(rr.value_numeric) : (rr.value_pct != null ? Number(rr.value_pct) : NaN);
    if (Number.isFinite(v) && rr.key in defaults) defaults[rr.key] = v;
  }

  const fromMs = new Date(fromISO).getTime();
  const toMs   = new Date(`${toISO}T23:59:59.999Z`).getTime();

  let active = 0, mrr = 0, newSubs = 0, churnedSubs = 0;
  let tenureSum = 0, tenureN = 0;
  for (const c of (clientsRes.data ?? []) as any[]) {
    if (c.status === 'active') { active++; mrr += Number(c.mrr_value) || 0; }
    const start = c.started_at ? new Date(c.started_at).getTime() : null;
    const churn = c.churned_at ? new Date(c.churned_at).getTime() : null;
    if (start !== null && start >= fromMs && start <= toMs) newSubs++;
    if (churn !== null && churn >= fromMs && churn <= toMs) churnedSubs++;
    if (c.tenure_months != null) {
      const t = Number(c.tenure_months);
      if (Number.isFinite(t)) { tenureSum += t; tenureN++; }
    }
  }

  let adSpend = 0;
  for (const r of (spendRes.data ?? []) as any[]) adSpend += Number(r.spend) || 0;

  let collected = 0, commission = 0;
  for (const r of (salesRes.data ?? []) as any[]) {
    collected  += Number(r.collected)       || 0;
    commission += Number(r.commission_paid) || 0;
  }

  const arpu        = active > 0 ? mrr / active : defaults.arpu;
  const cac         = newSubs > 0 ? adSpend / newSubs : null;
  const avgTenure   = tenureN > 0 ? tenureSum / tenureN : null;
  const ltv         = (avgTenure ?? 12) * arpu;
  const churnRate   = active + churnedSubs > 0 ? churnedSubs / (active + churnedSubs) : null;
  const revenue     = collected > 0 ? collected : mrr;

  const totalExpenses =
    adSpend
    + defaults.tech_cost
    + defaults.setup_cost_per_customer  * newSubs
    + defaults.setter_cost_per_customer * newSubs
    + defaults.csm_cost_per_active      * active
    + commission;
  const profitBeforeKd = revenue - totalExpenses;
  const kdShare        = profitBeforeKd > 0 ? profitBeforeKd * defaults.kd_profit_share_pct : 0;
  const netProfit      = profitBeforeKd - kdShare;

  return {
    month:               firstOfMonth(fromISO),
    mrr,
    active_subscribers:  active,
    new_subscribers:     newSubs,
    churned_subscribers: churnedSubs,
    churn_rate:          churnRate,
    ad_spend:            adSpend,
    cac,
    total_expenses:      totalExpenses,
    profit_before_kd:    profitBeforeKd,
    kd_share:            kdShare,
    net_profit:          netProfit,
    ltv,
    ltv_cac_ratio:       cac && ltv ? ltv / cac : null,
    payback_months:      cac && arpu ? cac / arpu : null,
  };
}

function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
