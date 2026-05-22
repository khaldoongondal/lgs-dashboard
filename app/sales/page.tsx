import PageShell from '@/components/page-shell';
import StatCard from '@/components/stat-card';
import EmptyState from '@/components/empty-state';
import ExportButton from '@/components/export-button';
import Link from 'next/link';
import { resolveRange } from '@/lib/date-range';
import { loadSalesSummary, type RepRow } from '@/lib/queries/sales';
import { fmtCurrency, fmtNumber, fmtPct } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type View = 'volume' | 'rates' | 'revenue' | 'commission';
const VIEWS: { value: View; label: string }[] = [
  { value: 'volume',     label: 'Volume'     },
  { value: 'rates',      label: 'Rates'      },
  { value: 'revenue',    label: 'Revenue'    },
  { value: 'commission', label: 'Commission' },
];

interface SP { preset?: string; from?: string; to?: string; view?: View }

function buildHref(base: Partial<SP>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  return `/sales?${sp.toString()}`;
}

export default async function SalesPage({ searchParams }: { searchParams: SP }) {
  const range = resolveRange(searchParams);
  const view: View = (searchParams.view as View) || 'volume';
  const { rows, total, avg, tiers } = await loadSalesSummary(range.from, range.to);

  const baseParams: Partial<SP> = { preset: range.preset, from: range.from, to: range.to, view };

  return (
    <PageShell current="/sales" title="Sales Pipeline"
      subtitle={`${range.from} → ${range.to} · one-call close`} range={range}>

      {/* Top KPI strip — headline numbers regardless of which view tab is active */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard label="Intro Calls"  value={fmtNumber(total.intro_calls)} />
        <StatCard label="Show %"       value={fmtPct(total.show_rate)}
                  hint={`${total.live_intros} live`} />
        <StatCard label="Close %"      value={fmtPct(total.close_rate)}
                  hint={`${total.closes} closes`} />
        <StatCard label="Collected"    value={fmtCurrency(total.collected)}
                  hint={total.collected_per_call != null
                    ? `${fmtCurrency(total.collected_per_call)} / call`
                    : undefined} />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Offers Made"  value={fmtNumber(total.offers_made)}
                  hint={`${fmtPct(total.offer_rate)} of lives`} />
        <StatCard label="Call → Close" value={fmtPct(total.call_to_close)}
                  hint="End-to-end" />
        <StatCard label="Total Revenue" value={fmtCurrency(total.total_revenue)}
                  hint={total.revenue_per_call != null
                    ? `${fmtCurrency(total.revenue_per_call)} / call`
                    : undefined} />
        <StatCard label="Commission $" value={fmtCurrency(total.commission)}
                  hint={`${(tiers.t1*100).toFixed(0)}/${(tiers.t2*100).toFixed(1)}/${(tiers.t3*100).toFixed(0)}% tiers`} />
      </section>

      {/* View tabs + Export */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-2">
            View
          </span>
          {VIEWS.map((v) => {
            const active = view === v.value;
            return (
              <Link
                key={v.value}
                href={buildHref({ ...baseParams, view: v.value })}
                className={[
                  'px-3 py-1.5 rounded-lg text-xs font-medium',
                  active ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                {v.label}
              </Link>
            );
          })}
        </div>
        <ExportButton table="sales" from={range.from} to={range.to} />
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title="No sales rows in this range"
            description="Sales metrics are aggregated daily from ghl_pipeline_events. Trigger /api/cron/sales-aggregate or wait for the daily run."
          />
        ) : (
          <table className="lgs-table">
            <thead>
              {view === 'volume' && (
                <tr>
                  <th>Rep</th>
                  <th className="!text-right">Intro Calls</th>
                  <th className="!text-right">Live Intros</th>
                  <th className="!text-right">Offers</th>
                  <th className="!text-right">Deposits</th>
                  <th className="!text-right">Verbal Commits</th>
                  <th className="!text-right">Closes</th>
                </tr>
              )}
              {view === 'rates' && (
                <tr>
                  <th>Rep</th>
                  <th className="!text-right">Show %</th>
                  <th className="!text-right">Offer %</th>
                  <th className="!text-right">Close %</th>
                  <th className="!text-right">Call → Close %</th>
                  <th className="!text-right">Commit %</th>
                </tr>
              )}
              {view === 'revenue' && (
                <tr>
                  <th>Rep</th>
                  <th className="!text-right">Collected</th>
                  <th className="!text-right">Total Revenue</th>
                  <th className="!text-right">$ / Call</th>
                  <th className="!text-right">$ / Offer</th>
                  <th className="!text-right">Rev / Call</th>
                  <th className="!text-right">Rev / Offer</th>
                </tr>
              )}
              {view === 'commission' && (
                <tr>
                  <th>Rep</th>
                  <th className="!text-right">Collected</th>
                  <th className="!text-right">Tier 1 ({(tiers.t1*100).toFixed(0)}%)</th>
                  <th className="!text-right">Tier 2 ({(tiers.t2*100).toFixed(1)}%)</th>
                  <th className="!text-right">Tier 3 ({(tiers.t3*100).toFixed(0)}%)</th>
                  <th className="!text-right">Commission</th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((r) => <Row key={r.rep_id} r={r} view={view} tiers={tiers} />)}
              <Row r={total} view={view} tiers={tiers} kind="summary" />
              <Row r={avg}   view={view} tiers={tiers} kind="summary" />
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Tier-1 cap $10k · Tier-2 cap $25k (per-rep, per-period).
        Rates editable in Settings → Expense Config.
      </p>
    </PageShell>
  );
}

function Row({ r, view, tiers, kind }: { r: RepRow; view: View; tiers: { t1: number; t2: number; t3: number }; kind?: 'summary' }) {
  const TIER_1_CAP = 10000;
  const TIER_2_CAP = 25000;

  // Per-rep tier breakdown for the commission view
  const c1 = Math.min(r.collected, TIER_1_CAP) * tiers.t1;
  const c2 = r.collected > TIER_1_CAP
    ? (Math.min(r.collected, TIER_2_CAP) - TIER_1_CAP) * tiers.t2
    : 0;
  const c3 = r.collected > TIER_2_CAP
    ? (r.collected - TIER_2_CAP) * tiers.t3
    : 0;

  return (
    <tr className={kind === 'summary' ? 'summary' : ''}>
      <td className="font-medium text-slate-900">{r.rep_name}</td>

      {view === 'volume' && (
        <>
          <td className="text-right tabular-nums">{fmtNumber(r.intro_calls, { maximumFractionDigits: 1 })}</td>
          <td className="text-right tabular-nums">{fmtNumber(r.live_intros, { maximumFractionDigits: 1 })}</td>
          <td className="text-right tabular-nums">{fmtNumber(r.offers_made, { maximumFractionDigits: 1 })}</td>
          <td className="text-right tabular-nums">{fmtNumber(r.deposits,    { maximumFractionDigits: 1 })}</td>
          <td className="text-right tabular-nums">{fmtNumber(r.verbal_commitments, { maximumFractionDigits: 1 })}</td>
          <td className="text-right tabular-nums">{fmtNumber(r.closes,      { maximumFractionDigits: 1 })}</td>
        </>
      )}

      {view === 'rates' && (
        <>
          <td className="text-right tabular-nums">{fmtPct(r.show_rate)}</td>
          <td className="text-right tabular-nums">{fmtPct(r.offer_rate)}</td>
          <td className="text-right tabular-nums">{fmtPct(r.close_rate)}</td>
          <td className="text-right tabular-nums">{fmtPct(r.call_to_close)}</td>
          <td className="text-right tabular-nums">{fmtPct(r.call_commitment)}</td>
        </>
      )}

      {view === 'revenue' && (
        <>
          <td className="text-right tabular-nums">{fmtCurrency(r.collected)}</td>
          <td className="text-right tabular-nums">{fmtCurrency(r.total_revenue)}</td>
          <td className="text-right tabular-nums">{r.collected_per_call  != null ? fmtCurrency(r.collected_per_call)  : '—'}</td>
          <td className="text-right tabular-nums">{r.collected_per_offer != null ? fmtCurrency(r.collected_per_offer) : '—'}</td>
          <td className="text-right tabular-nums">{r.revenue_per_call    != null ? fmtCurrency(r.revenue_per_call)    : '—'}</td>
          <td className="text-right tabular-nums">{r.revenue_per_offer   != null ? fmtCurrency(r.revenue_per_offer)   : '—'}</td>
        </>
      )}

      {view === 'commission' && (
        <>
          <td className="text-right tabular-nums">{fmtCurrency(r.collected)}</td>
          <td className="text-right tabular-nums">{fmtCurrency(c1)}</td>
          <td className="text-right tabular-nums">{fmtCurrency(c2)}</td>
          <td className="text-right tabular-nums">{fmtCurrency(c3)}</td>
          <td className="text-right tabular-nums font-semibold">{fmtCurrency(r.commission)}</td>
        </>
      )}
    </tr>
  );
}
