import PageShell from '@/components/page-shell';
import StatCard from '@/components/stat-card';
import EmptyState from '@/components/empty-state';
import { resolveRange } from '@/lib/date-range';
import {
  aggregateAttribution, totalsRow,
  type DrillLevel, type AttributionFilter,
} from '@/lib/queries/attribution';
import { fmtCurrency, fmtNumber } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LEVELS: { value: DrillLevel; label: string; singular: string }[] = [
  { value: 'source',   label: 'Sources',   singular: 'Source'   },
  { value: 'campaign', label: 'Campaigns', singular: 'Campaign' },
  { value: 'adset',    label: 'Adsets',    singular: 'Adset'    },
  { value: 'medium',   label: 'Medium',    singular: 'Medium'   },
  { value: 'ad',       label: 'Ads',       singular: 'Ad'       },
];

// What level to advance to when the user clicks a row at the current level.
// Hierarchy: source → campaign → adset → ad
const NEXT_LEVEL: Partial<Record<DrillLevel, DrillLevel>> = {
  source:   'campaign',
  campaign: 'adset',
  adset:    'ad',
};

interface SP {
  preset?: string; from?: string; to?: string;
  level?: DrillLevel;
  source?: string; campaign?: string; adset?: string;
  active?: string;
}

function buildHref(base: Partial<SP>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  return `/dashboard?${sp.toString()}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const range = resolveRange(searchParams);
  const level: DrillLevel = (searchParams.level as DrillLevel) || 'source';
  const filter: AttributionFilter = {
    source:   searchParams.source,
    campaign: searchParams.campaign,
    adset:    searchParams.adset,
    active:   searchParams.active === '1',
  };

  const rows = await aggregateAttribution(level, range.from, range.to, filter);
  const total = totalsRow(rows);

  const baseParams: Partial<SP> = {
    preset: range.preset,
    from:   range.from,
    to:     range.to,
    ...(filter.active ? { active: '1' } : {}),
  };

  // Breadcrumb segments: Home → (Source) → (Campaign) → (Adset)
  type Crumb = { label: string; href: string };
  const crumbs: Crumb[] = [
    { label: 'All', href: buildHref({ ...baseParams, level: 'source' }) },
  ];
  if (filter.source) {
    crumbs.push({
      label: `Source: ${filter.source}`,
      href: buildHref({ ...baseParams, level: 'campaign', source: filter.source }),
    });
  }
  if (filter.campaign) {
    crumbs.push({
      label: `Campaign: ${filter.campaign}`,
      href: buildHref({
        ...baseParams, level: 'adset',
        source: filter.source, campaign: filter.campaign,
      }),
    });
  }
  if (filter.adset) {
    crumbs.push({
      label: `Adset: ${filter.adset}`,
      href: buildHref({
        ...baseParams, level: 'ad',
        source: filter.source, campaign: filter.campaign, adset: filter.adset,
      }),
    });
  }

  const activeHref = buildHref({
    ...baseParams,
    level,
    source: filter.source, campaign: filter.campaign, adset: filter.adset,
    active: filter.active ? undefined : '1',
  });

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

      {/* Breadcrumb */}
      {crumbs.length > 1 && (
        <nav className="flex items-center gap-1.5 mb-3 text-xs text-slate-600 flex-wrap">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-300">/</span>}
              {i < crumbs.length - 1 ? (
                <Link href={c.href} className="hover:underline text-slate-700">{c.label}</Link>
              ) : (
                <span className="font-medium text-slate-900">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Drill tabs + Active toggle */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-2">
            Drill by
          </span>
          {LEVELS.map((l) => {
            const active = level === l.value;
            return (
              <Link
                key={l.value}
                href={buildHref({
                  ...baseParams,
                  level: l.value,
                  source: filter.source, campaign: filter.campaign, adset: filter.adset,
                })}
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

        <Link
          href={activeHref}
          className={[
            'px-3 py-1.5 rounded-lg text-xs font-medium border',
            filter.active
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
          ].join(' ')}
        >
          {filter.active ? '✓ Active only' : 'Active only'}
        </Link>
      </div>

      {/* Drill table */}
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title="No attribution data for this slice"
            description="Try a wider date range, clear filters, or turn off the active-only toggle."
          />
        ) : (
          <table className="lgs-table">
            <thead>
              <tr>
                <th className="!text-left">{LEVELS.find((l) => l.value === level)?.singular}</th>
                {level !== 'source' && level !== 'medium' && (
                  <th className="!text-left">Status</th>
                )}
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
              {rows.map((r) => {
                const nextLevel = NEXT_LEVEL[level];
                const canDrillDeeper = !!nextLevel;
                const drillHref = canDrillDeeper ? buildHref({
                  ...baseParams,
                  level: nextLevel,
                  source:   level === 'source'   ? r.label : filter.source,
                  campaign: level === 'campaign' ? r.label : filter.campaign,
                  adset:    level === 'adset'    ? r.label : filter.adset,
                }) : null;

                const labelCell = drillHref ? (
                  <Link href={drillHref} className="text-indigo-600 hover:underline">{r.label}</Link>
                ) : (
                  <span>{r.label}</span>
                );

                return (
                  <tr key={r.key}>
                    <td className="font-medium text-slate-900">{labelCell}</td>
                    {level !== 'source' && level !== 'medium' && (
                      <td className="text-left">
                        <StatusPill status={r.status} />
                      </td>
                    )}
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
                );
              })}
              <tr className="summary">
                <td>Total</td>
                {level !== 'source' && level !== 'medium' && <td />}
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

function StatusPill({ status }: { status?: string | null }) {
  if (!status) return <span className="text-slate-400 text-xs">—</span>;
  const isActive = status === 'ACTIVE';
  const cls = isActive
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${cls}`}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}
