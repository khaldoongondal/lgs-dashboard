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

function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
