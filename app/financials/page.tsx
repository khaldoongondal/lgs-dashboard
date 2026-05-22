import PageShell from '@/components/page-shell';
import StatCard from '@/components/stat-card';
import EmptyState from '@/components/empty-state';
import { resolveRange } from '@/lib/date-range';
import { loadMonthlySnapshots, loadClientCounts, deriveCurrentSnapshot } from '@/lib/queries/financials';
import { fmtCurrency, fmtNumber, fmtPct } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: { preset?: string; from?: string; to?: string };
}) {
  const range = resolveRange(searchParams);
  const [snapshots, counts, live] = await Promise.all([
    loadMonthlySnapshots(range.from, range.to),
    loadClientCounts(),
    deriveCurrentSnapshot(range.from, range.to),
  ]);

  // Prefer the latest persisted snapshot; fall back to a live-derived one so
  // the headline cards never show empty before the monthly cron has run.
  const latest = snapshots[0] ?? live;

  return (
    <PageShell current="/financials" title="Financials"
      subtitle="MRR, expenses, profit. Restricted area."
      range={range}>

      {/* Headline cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="MRR"
          value={fmtCurrency(latest?.mrr)}
          hint={`${counts.active} active clients`}
        />
        <StatCard
          label="Net Profit"
          value={fmtCurrency(latest?.net_profit)}
          accent={(latest?.net_profit ?? 0) >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          label="CAC"
          value={fmtCurrency(latest?.cac)}
          hint={latest?.ltv_cac_ratio != null ? `LTV:CAC ${latest.ltv_cac_ratio.toFixed(2)}x` : undefined}
        />
        <StatCard
          label="Churn Rate"
          value={fmtPct(latest?.churn_rate)}
          hint={`${counts.churned} all-time churned`}
          accent={(latest?.churn_rate ?? 0) <= 0.05 ? 'success' : 'warn'}
        />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Ad Spend"        value={fmtCurrency(latest?.ad_spend)} />
        <StatCard label="Total Expenses"  value={fmtCurrency(latest?.total_expenses)} />
        <StatCard label="KD Share"        value={fmtCurrency(latest?.kd_share)} />
        <StatCard label="LTV"             value={fmtCurrency(latest?.ltv)}
                  hint={latest?.payback_months != null ? `${latest.payback_months.toFixed(1)} mo payback` : undefined} />
      </section>

      {/* Monthly P&L table */}
      <div className="card overflow-x-auto mb-6">
        {snapshots.length === 0 ? (
          <EmptyState
            title="No monthly snapshots yet"
            description="The monthly_kpi_snapshots table is empty. Run the rollup job (or insert your first actual month) to populate this view."
          />
        ) : (
          <table className="lgs-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="!text-right">Active</th>
                <th className="!text-right">New</th>
                <th className="!text-right">Churned</th>
                <th className="!text-right">Churn %</th>
                <th className="!text-right">MRR</th>
                <th className="!text-right">Ad Spend</th>
                <th className="!text-right">CAC</th>
                <th className="!text-right">Expenses</th>
                <th className="!text-right">Profit (pre-KD)</th>
                <th className="!text-right">Net Profit</th>
                <th className="!text-right">LTV</th>
                <th className="!text-right">LTV:CAC</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.month}>
                  <td className="font-medium text-slate-900">{s.month.slice(0, 7)}</td>
                  <td className="text-right tabular-nums">{fmtNumber(s.active_subscribers)}</td>
                  <td className="text-right tabular-nums">{fmtNumber(s.new_subscribers)}</td>
                  <td className="text-right tabular-nums">{fmtNumber(s.churned_subscribers)}</td>
                  <td className="text-right tabular-nums">{fmtPct(s.churn_rate)}</td>
                  <td className="text-right tabular-nums">{fmtCurrency(s.mrr)}</td>
                  <td className="text-right tabular-nums">{fmtCurrency(s.ad_spend)}</td>
                  <td className="text-right tabular-nums">{fmtCurrency(s.cac)}</td>
                  <td className="text-right tabular-nums">{fmtCurrency(s.total_expenses)}</td>
                  <td className="text-right tabular-nums">{fmtCurrency(s.profit_before_kd)}</td>
                  <td className="text-right tabular-nums">{fmtCurrency(s.net_profit)}</td>
                  <td className="text-right tabular-nums">{fmtCurrency(s.ltv)}</td>
                  <td className="text-right tabular-nums">
                    {s.ltv_cac_ratio != null ? `${s.ltv_cac_ratio.toFixed(2)}x` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card-pad">
        <div className="text-sm font-medium text-slate-900">Backfill / refresh snapshots</div>
        <p className="mt-1 text-sm text-slate-500">
          Snapshot rows are computed from clients + meta_ad_performance + sales_metrics + expense_config.
          Trigger <code>/api/cron/monthly-snapshot?month=YYYY-MM&amp;secret=...</code> to write or
          refresh a specific month. Use <code>?since=&amp;until=</code> for backfills (max 36 months).
        </p>
      </div>
    </PageShell>
  );
}
