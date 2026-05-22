import PageShell from '@/components/page-shell';
import StatCard from '@/components/stat-card';
import EmptyState from '@/components/empty-state';
import { resolveRange } from '@/lib/date-range';
import { aggregateFunnel, type FunnelStep } from '@/lib/queries/funnel';
import { fmtNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SP { preset?: string; from?: string; to?: string }

function fmtPct(v: number | null, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

const BAND_BG: Record<FunnelStep['band'], string> = {
  green:   'bg-emerald-500',
  amber:   'bg-amber-500',
  red:     'bg-red-500',
  neutral: 'bg-slate-500',
};

const BAND_TINT: Record<FunnelStep['band'], string> = {
  green:   'bg-emerald-50  text-emerald-700  border-emerald-200',
  amber:   'bg-amber-50    text-amber-700    border-amber-200',
  red:     'bg-red-50      text-red-700      border-red-200',
  neutral: 'bg-slate-50    text-slate-600    border-slate-200',
};

export default async function FunnelPage({ searchParams }: { searchParams: SP }) {
  const range = resolveRange(searchParams);
  const data  = await aggregateFunnel(range.from, range.to);

  const topCount = data.steps[0]?.count ?? 0;

  return (
    <PageShell current="/dashboard/funnel" title="Funnel"
      subtitle={`${range.from} → ${range.to}`} range={range}>

      {/* Headline KPI: Full Funnel % */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Full Funnel %"
          value={fmtPct(data.fullFunnel, 2)}
          hint="Closes ÷ VSL visitors"
          accent={data.fullFunnel !== null && data.fullFunnel >= 0.02 ? 'success' : 'default'}
        />
        <StatCard label="VSL Visitors" value={fmtNumber(data.steps[0]?.count ?? 0)} />
        <StatCard label="Opt-ins"      value={fmtNumber(data.steps[2]?.count ?? 0)} />
        <StatCard label="Closes"       value={fmtNumber(data.steps[5]?.count ?? 0)} />
      </section>

      {/* Waterfall */}
      <div className="card mb-6">
        <div className="px-4 pt-4 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Conversion Waterfall
        </div>
        {data.steps.length === 0 || topCount === 0 ? (
          <EmptyState
            title="No funnel data for this range"
            description="Pixel needs to be deployed on your funnel pages. Once visitors land + opt-in, this fills in."
          />
        ) : (
          <div className="px-4 pb-4 space-y-2">
            {data.steps.map((s, i) => {
              const widthPct = topCount > 0 ? Math.max(2, (s.count / topCount) * 100) : 0;
              const isFirst  = i === 0;
              return (
                <div key={s.key} className="grid grid-cols-12 items-center gap-3">
                  <div className="col-span-2 text-sm font-medium text-slate-900">{s.label}</div>
                  <div className="col-span-6">
                    <div className="h-6 bg-slate-100 rounded-md overflow-hidden">
                      <div
                        className={`h-full rounded-md transition-all ${BAND_BG[s.band]}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="col-span-1 text-right text-sm tabular-nums font-medium text-slate-900">
                    {fmtNumber(s.count)}
                  </div>
                  <div className="col-span-1 text-right text-xs tabular-nums text-slate-600">
                    {isFirst ? '—' : fmtPct(s.conversion, 1)}
                  </div>
                  <div className="col-span-2 text-right">
                    {isFirst ? (
                      <span className="text-xs text-slate-400">starting point</span>
                    ) : (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${BAND_TINT[s.band]}`}>
                        ↓ {fmtPct(s.dropoff, 1)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="grid grid-cols-12 items-center gap-3 pt-2 border-t border-slate-100">
              <div className="col-span-2 text-sm font-semibold text-slate-900">Full Funnel</div>
              <div className="col-span-6" />
              <div className="col-span-1" />
              <div className="col-span-3 text-right text-sm font-semibold text-slate-900 tabular-nums">
                {fmtPct(data.fullFunnel, 2)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Per-page breakdown */}
      <div className="card overflow-x-auto">
        <div className="px-4 pt-4 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Per-Page Traffic
        </div>
        <table className="lgs-table">
          <thead>
            <tr>
              <th className="!text-left">Page</th>
              <th className="!text-right">Unique Visitors</th>
              <th className="!text-right">Page Views</th>
              <th className="!text-right">Views / Visitor</th>
            </tr>
          </thead>
          <tbody>
            {data.pageBreakdown.map((row) => (
              <tr key={row.page_slug}>
                <td className="font-medium text-slate-900">{labelForSlug(row.page_slug)}</td>
                <td className="text-right tabular-nums">{fmtNumber(row.unique_visitors)}</td>
                <td className="text-right tabular-nums">{fmtNumber(row.page_views)}</td>
                <td className="text-right tabular-nums">
                  {row.unique_visitors > 0
                    ? (row.page_views / row.unique_visitors).toFixed(2)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Color coding: <span className="text-emerald-700">green</span> = at or above industry benchmark,
        <span className="text-amber-700"> amber</span> = acceptable,
        <span className="text-red-700"> red</span> = below benchmark.
        Tune the benchmarks in <code className="text-[11px]">lib/queries/funnel.ts</code>.
      </p>
    </PageShell>
  );
}

function labelForSlug(slug: string): string {
  switch (slug) {
    case 'vsl':       return 'VSL';
    case 'optin':     return 'Opt-in';
    case 'booking':   return 'Booking';
    case 'thankyou':  return 'Thank You';
    default:          return slug;
  }
}
