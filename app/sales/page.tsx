import PageShell from '@/components/page-shell';
import StatCard from '@/components/stat-card';
import EmptyState from '@/components/empty-state';
import { resolveRange } from '@/lib/date-range';
import { loadSalesSummary, type RepRow } from '@/lib/queries/sales';
import { fmtCurrency, fmtNumber, fmtPct } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function repRow(r: RepRow, summary = false) {
  return (
    <tr key={r.rep_id} className={summary ? 'summary' : ''}>
      <td className="font-medium text-slate-900">{r.rep_name}</td>
      <td className="text-right tabular-nums">{fmtNumber(r.intro_calls, { maximumFractionDigits: 1 })}</td>
      <td className="text-right tabular-nums">{fmtNumber(r.live_intros, { maximumFractionDigits: 1 })}</td>
      <td className="text-right tabular-nums">{fmtPct(r.show_rate)}</td>
      <td className="text-right tabular-nums">{fmtNumber(r.offers_made, { maximumFractionDigits: 1 })}</td>
      <td className="text-right tabular-nums">{fmtPct(r.offer_rate)}</td>
      <td className="text-right tabular-nums">{fmtNumber(r.closes, { maximumFractionDigits: 1 })}</td>
      <td className="text-right tabular-nums">{fmtPct(r.close_rate)}</td>
      <td className="text-right tabular-nums">{fmtPct(r.call_to_close)}</td>
      <td className="text-right tabular-nums">{fmtCurrency(r.collected)}</td>
      <td className="text-right tabular-nums">{fmtCurrency(r.collected_per_call)}</td>
    </tr>
  );
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { preset?: string; from?: string; to?: string };
}) {
  const range = resolveRange(searchParams);
  const { rows, total, avg } = await loadSalesSummary(range.from, range.to);

  return (
    <PageShell current="/sales" title="Sales Pipeline"
      subtitle={`${range.from} → ${range.to} · one-call close`} range={range}>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Intro Calls"    value={fmtNumber(total.intro_calls)} />
        <StatCard label="Show Rate"      value={fmtPct(total.show_rate)}
                  hint={`${total.live_intros} live`} />
        <StatCard label="Close Rate"     value={fmtPct(total.close_rate)}
                  hint={`${total.closes} closes`} />
        <StatCard label="Collected"      value={fmtCurrency(total.collected)}
                  hint={total.collected_per_call != null
                    ? `${fmtCurrency(total.collected_per_call)} / call`
                    : undefined} />
      </section>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title="No sales rows in this range"
            description="Sales metrics are aggregated daily per rep. Populate sales_metrics (manually or via a daily rollup job) to light this table up."
          />
        ) : (
          <table className="lgs-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th className="!text-right">Intro Calls</th>
                <th className="!text-right">Live Intros</th>
                <th className="!text-right">Show %</th>
                <th className="!text-right">Offers</th>
                <th className="!text-right">Offer %</th>
                <th className="!text-right">Closes</th>
                <th className="!text-right">Close %</th>
                <th className="!text-right">Call→Close %</th>
                <th className="!text-right">Collected</th>
                <th className="!text-right">$ / Call</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => repRow(r))}
              {repRow(total, true)}
              {repRow(avg, true)}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
}
