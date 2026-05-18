import PageShell from '@/components/page-shell';
import StatCard from '@/components/stat-card';
import EmptyState from '@/components/empty-state';
import { resolveRange } from '@/lib/date-range';
import { aggregateAttribution, totalsRow, type DrillLevel } from '@/lib/queries/attribution';
import { fmtCurrency, fmtNumber, fmtPct } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LEVELS: { value: DrillLevel; label: string }[] = [
  { value: 'source',   label: 'Sources' },
  { value: 'campaign', label: 'Campaigns' },
  { value: 'medium',   label: 'Medium' },
  { value: 'ad',       label: 'Ads' },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { preset?: string; from?: string; to?: string; level?: DrillLevel };
}) {
  const range = resolveRange(searchParams);
  const level: DrillLevel = (searchParams.level as DrillLevel) || 'campaign';
  const rows = await aggregateAttribution(level, range.from, range.to);
  const total = totalsRow(rows);

  return (
    <PageShell current="/dashboard" title="Ad Attribution"
      subtitle={`${range.from} → ${range.to}`} range={range}>

      {/* KPI cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Ad Spend"   value={fmtCurrency(total.spend)} />
        <StatCard label="Page Views" value={fmtNumber(total.page_views)} />
        <StatCard label="Leads"      value={fmtNumber(total.leads)}
                  hint={total.cpl != null ? `CPL ${fmtCurrency(total.cpl)}` : undefined} />
        <StatCard label="Closes"     value={fmtNumber(total.closes)}
                  hint={total.cac != null ? `CAC ${fmtCurrency(total.cac)}` : undefined} />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Booked"  value={fmtNumber(total.booked)}
                  hint={total.cost_booked != null ? `Cost/Booked ${fmtCurrency(total.cost_booked)}` : undefined} />
        <StatCard label="Shown"   value={fmtNumber(total.shown)}
                  hint={total.cost_shown != null ? `Cost/Shown ${fmtCurrency(total.cost_shown)}` : undefined} />
        <StatCard label="Revenue" value={fmtCurrency(total.revenue)} />
        <StatCard label="ROAS"    value={total.roas != null ? `${total.roas.toFixed(2)}x` : '—'}
                  accent={total.roas != null && total.roas >= 2 ? 'success' : 'default'} />
      </section>

      {/* Drill tabs */}
      <div className="flex items-center gap-1 mb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-2">
          Drill by
        </span>
        {LEVELS.map((l) => {
          const active = level === l.value;
          const sp = new URLSearchParams();
          sp.set('preset', range.preset);
          sp.set('from', range.from);
          sp.set('to', range.to);
          sp.set('level', l.value);
          return (
            <Link
              key={l.value}
              href={`/dashboard?${sp.toString()}`}
              className={[
                'px-3 py-1.5 rounded-lg text-xs font-medium',
                active ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50',
              ].join(' ')}
            >
              {l.label}
            </Link>
          );
        })}
      </div>

      {/* Drill table */}
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title="No attribution data in this range"
            description="Once Meta Ads syncs spend and GHL webhooks deliver lead/booked/shown/purchase events, rows will appear here."
          />
        ) : (
          <table className="lgs-table">
            <thead>
              <tr>
                <th className="!text-left">{LEVELS.find((l) => l.value === level)?.label.slice(0, -1)}</th>
                <th className="!text-right">Spend</th>
                <th className="!text-right">Page Views</th>
                <th className="!text-right">Leads</th>
                <th className="!text-right">CPL</th>
                <th className="!text-right">Booked</th>
                <th className="!text-right">Shown</th>
                <th className="!text-right">Closes</th>
                <th className="!text-right">CAC</th>
                <th className="!text-right">Revenue</th>
                <th className="!text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="font-medium text-slate-900">{r.label}</td>
                  <td className="text-right tabular-nums">{fmtCurrency(r.spend)}</td>
                  <td className="text-right tabular-nums">{fmtNumber(r.page_views)}</td>
                  <td className="text-right tabular-nums">{fmtNumber(r.leads)}</td>
                  <td className="text-right tabular-nums">{r.cpl != null ? fmtCurrency(r.cpl) : '—'}</td>
                  <td className="text-right tabular-nums">{fmtNumber(r.booked)}</td>
                  <td className="text-right tabular-nums">{fmtNumber(r.shown)}</td>
                  <td className="text-right tabular-nums">{fmtNumber(r.closes)}</td>
                  <td className="text-right tabular-nums">{r.cac != null ? fmtCurrency(r.cac) : '—'}</td>
                  <td className="text-right tabular-nums">{fmtCurrency(r.revenue)}</td>
                  <td className="text-right tabular-nums">
                    {r.roas != null ? `${r.roas.toFixed(2)}x` : '—'}
                  </td>
                </tr>
              ))}
              <tr className="summary">
                <td>Total</td>
                <td className="text-right tabular-nums">{fmtCurrency(total.spend)}</td>
                <td className="text-right tabular-nums">{fmtNumber(total.page_views)}</td>
                <td className="text-right tabular-nums">{fmtNumber(total.leads)}</td>
                <td className="text-right tabular-nums">{total.cpl != null ? fmtCurrency(total.cpl) : '—'}</td>
                <td className="text-right tabular-nums">{fmtNumber(total.booked)}</td>
                <td className="text-right tabular-nums">{fmtNumber(total.shown)}</td>
                <td className="text-right tabular-nums">{fmtNumber(total.closes)}</td>
                <td className="text-right tabular-nums">{total.cac != null ? fmtCurrency(total.cac) : '—'}</td>
                <td className="text-right tabular-nums">{fmtCurrency(total.revenue)}</td>
                <td className="text-right tabular-nums">
                  {total.roas != null ? `${total.roas.toFixed(2)}x` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
}
