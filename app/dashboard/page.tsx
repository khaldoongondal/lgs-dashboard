import PageShell from '@/components/page-shell';
import StatCard from '@/components/stat-card';
import EmptyState from '@/components/empty-state';
import { resolveRange } from '@/lib/date-range';
import {
  aggregateAttribution, totalsRow,
  type DrillLevel, type AttributionFilter, type AttributionRow,
} from '@/lib/queries/attribution';
import { detectAnomalies, type Anomaly } from '@/lib/queries/anomalies';
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

const NEXT_LEVEL: Partial<Record<DrillLevel, DrillLevel>> = {
  source:   'campaign',
  campaign: 'adset',
  adset:    'ad',
};

type View = 'funnel' | 'meta' | 'creative';
const VIEWS: { value: View; label: string }[] = [
  { value: 'funnel',   label: 'Funnel'        },
  { value: 'meta',     label: 'Meta-Reported' },
  { value: 'creative', label: 'Creative'      },
];

interface SP {
  preset?: string; from?: string; to?: string;
  level?: DrillLevel;
  view?:  View;
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

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtPctAbs(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const range = resolveRange(searchParams);
  const level: DrillLevel = (searchParams.level as DrillLevel) || 'source';
  const view:  View       = (searchParams.view  as View)       || 'funnel';
  const filter: AttributionFilter = {
    source:   searchParams.source,
    campaign: searchParams.campaign,
    adset:    searchParams.adset,
    active:   searchParams.active === '1',
  };

  const [rows, anomalies] = await Promise.all([
    aggregateAttribution(level, range.from, range.to, filter),
    detectAnomalies(),
  ]);
  const total = totalsRow(rows);

  const baseParams: Partial<SP> = {
    preset: range.preset,
    from:   range.from,
    to:     range.to,
    view,
    ...(filter.active ? { active: '1' } : {}),
  };

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

      {/* Anomaly cards — yesterday vs 7d baseline */}
      <AnomalyBanner anomalies={anomalies} />

      {/* Funnel KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard label="Ad Spend"   value={fmtCurrency(total.spend)} />
        <StatCard label="Page Views" value={fmtNumber(total.page_views)} />
        <StatCard label="Leads"      value={fmtNumber(total.leads)}
                  hint={total.cpl != null ? `CPL ${fmtCurrency(total.cpl)}` : undefined} />
        <StatCard label="Closes"     value={fmtNumber(total.closes)}
                  hint={total.cac != null ? `CAC ${fmtCurrency(total.cac)}` : undefined} />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard label="Booked"  value={fmtNumber(total.booked)}
                  hint={total.cost_booked != null ? `Cost/Booked ${fmtCurrency(total.cost_booked)}` : undefined} />
        <StatCard label="Shown"   value={fmtNumber(total.shown)}
                  hint={total.cost_shown != null ? `Cost/Shown ${fmtCurrency(total.cost_shown)}` : undefined} />
        <StatCard label="Revenue" value={fmtCurrency(total.revenue)}
                  hint={total.roi_pct != null ? `ROI ${fmtPctAbs(total.roi_pct)}` : undefined} />
        <StatCard label="ROAS"    value={total.roas != null ? `${total.roas.toFixed(2)}x` : '—'}
                  accent={total.roas != null && total.roas >= 2 ? 'success' : 'default'} />
      </section>

      {/* Meta-Reported KPIs — what Meta says vs what we measured. */}
      <section className="mb-6">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">
          Meta Reported
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Impressions" value={fmtNumber(total.impressions)}
                    hint={total.ctr != null ? `CTR ${fmtPct(total.ctr)}` : undefined} />
          <StatCard label="Meta Leads"  value={fmtNumber(total.meta_leads)}
                    hint={total.meta_cpl != null ? `Meta CPL ${fmtCurrency(total.meta_cpl)}` : undefined} />
          <StatCard label="Hook Rate"   value={fmtPct(total.hook_rate, 1)}
                    hint={`${fmtNumber(total.video_p3_watched)} 3-sec`} />
          <StatCard label="Video Plays" value={fmtNumber(total.video_play_actions)}
                    hint={total.video_play_rate != null ? `Play Rate ${fmtPct(total.video_play_rate, 1)}` : undefined} />
        </div>
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

      {/* Drill tabs + View tabs + Active toggle */}
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
                className={`pill ${active ? 'pill-active' : ''}`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        <Link
          href={activeHref}
          className={`pill ${filter.active ? 'pill-active' : ''}`}
        >
          {filter.active ? '✓ Active only' : 'Active only'}
        </Link>
      </div>

      <div className="flex items-center gap-1 mb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-2">
          View
        </span>
        {VIEWS.map((v) => {
          const active = view === v.value;
          return (
            <Link
              key={v.value}
              href={buildHref({
                ...baseParams,
                view: v.value,
                level,
                source: filter.source, campaign: filter.campaign, adset: filter.adset,
              })}
              className={`pill ${active ? 'pill-active' : ''}`}
            >
              {v.label}
            </Link>
          );
        })}
      </div>

      {/* Drill table */}
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title="No attribution data for this slice"
            description="Try a wider date range, clear filters, or turn off the active-only toggle."
          />
        ) : (
          <DrillTable
            rows={rows}
            total={total}
            level={level}
            view={view}
            filter={filter}
            baseParams={baseParams}
          />
        )}
      </div>
    </PageShell>
  );
}

// ── Drill table — column set varies by view ─────────────────────────
function DrillTable({
  rows, total, level, view, filter, baseParams,
}: {
  rows: AttributionRow[];
  total: AttributionRow;
  level: DrillLevel;
  view: View;
  filter: AttributionFilter;
  baseParams: Partial<SP>;
}) {
  const showStatus = level !== 'source' && level !== 'medium';
  const singular = LEVELS.find((l) => l.value === level)?.singular;

  return (
    <table className="lgs-table">
      <thead>
        <tr>
          <th className="!text-left">{singular}</th>
          {showStatus && <th className="!text-left">Status</th>}
          {view === 'funnel' && (
            <>
              <th className="!text-right">Spend</th>
              <th className="!text-right">Page Views</th>
              <th className="!text-right">Leads</th>
              <th className="!text-right">CPL</th>
              <th className="!text-right">Booked</th>
              <th className="!text-right">Unique Booked</th>
              <th className="!text-right">Shown</th>
              <th className="!text-right">Closes</th>
              <th className="!text-right">CAC</th>
              <th className="!text-right">Revenue</th>
              <th className="!text-right">ROAS</th>
              <th className="!text-right">ROI %</th>
            </>
          )}
          {view === 'meta' && (
            <>
              <th className="!text-right">Spend</th>
              <th className="!text-right">Impressions</th>
              <th className="!text-right">Reach</th>
              <th className="!text-right">Clicks</th>
              <th className="!text-right">CTR</th>
              <th className="!text-right">CPM</th>
              <th className="!text-right">CPC</th>
              <th className="!text-right">Meta Leads</th>
              <th className="!text-right">Meta CPL</th>
              <th className="!text-right">Our CPL</th>
              <th className="!text-right">Meta Purch.</th>
            </>
          )}
          {view === 'creative' && (
            <>
              <th className="!text-right">Spend</th>
              <th className="!text-right">Impressions</th>
              <th className="!text-right">3-Sec Plays</th>
              <th className="!text-right">Hook Rate</th>
              <th className="!text-right">Video Plays</th>
              <th className="!text-right">Play Rate</th>
              <th className="!text-right">Link Clicks</th>
              <th className="!text-right">Cost/Link Click</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const nextLevel = NEXT_LEVEL[level];
          const drillHref = nextLevel ? buildHref({
            ...baseParams,
            level: nextLevel,
            source:   level === 'source'   ? r.label : filter.source,
            campaign: level === 'campaign' ? r.label : filter.campaign,
            adset:    level === 'adset'    ? r.label : filter.adset,
          }) : null;

          const labelCell = drillHref ? (
            <Link href={drillHref} className="font-medium text-brand-700 hover:underline">{r.label}</Link>
          ) : (
            <span>{r.label}</span>
          );

          const labelWithThumb = level === 'ad' && r.thumbnail_url ? (
            <span className="flex items-center gap-2">
              {r.permalink_url ? (
                <a href={r.permalink_url} target="_blank" rel="noopener noreferrer" title="Open in Meta">
                  <img src={r.thumbnail_url} alt="" className="w-10 h-10 rounded object-cover border border-slate-200" />
                </a>
              ) : (
                <img src={r.thumbnail_url} alt="" className="w-10 h-10 rounded object-cover border border-slate-200" />
              )}
              {labelCell}
            </span>
          ) : labelCell;

          return (
            <tr key={r.key}>
              <td className="font-medium text-slate-900">{labelWithThumb}</td>
              {showStatus && (
                <td className="text-left">
                  <StatusPill status={r.status} />
                </td>
              )}
              {view === 'funnel' && <FunnelCells r={r} />}
              {view === 'meta'   && <MetaCells   r={r} />}
              {view === 'creative' && <CreativeCells r={r} />}
            </tr>
          );
        })}
        <tr className="summary">
          <td>Total</td>
          {showStatus && <td />}
          {view === 'funnel' && <FunnelCells r={total} />}
          {view === 'meta'   && <MetaCells   r={total} />}
          {view === 'creative' && <CreativeCells r={total} />}
        </tr>
      </tbody>
    </table>
  );
}

function num(n: number)             { return <td className="text-right tabular-nums">{fmtNumber(n)}</td>; }
function cur(n: number)             { return <td className="text-right tabular-nums">{fmtCurrency(n)}</td>; }
function curOrDash(n: number | null | undefined) {
  return <td className="text-right tabular-nums">{n != null ? fmtCurrency(n) : '—'}</td>;
}
function pct(n: number | null | undefined, digits = 2) {
  return <td className="text-right tabular-nums">{fmtPct(n, digits)}</td>;
}
function pctAbs(n: number | null | undefined, digits = 1) {
  return <td className="text-right tabular-nums">{fmtPctAbs(n, digits)}</td>;
}

function FunnelCells({ r }: { r: AttributionRow }) {
  return (
    <>
      {cur(r.spend)}
      {num(r.page_views)}
      {num(r.leads)}
      {curOrDash(r.cpl)}
      {num(r.booked)}
      {num(r.unique_booked)}
      {num(r.shown)}
      {num(r.closes)}
      {curOrDash(r.cac)}
      {cur(r.revenue)}
      <td className="text-right tabular-nums">{r.roas != null ? `${r.roas.toFixed(2)}x` : '—'}</td>
      {pctAbs(r.roi_pct)}
    </>
  );
}

function MetaCells({ r }: { r: AttributionRow }) {
  return (
    <>
      {cur(r.spend)}
      {num(r.impressions)}
      {num(r.reach)}
      {num(r.clicks)}
      {pct(r.ctr)}
      {curOrDash(r.cpm)}
      {curOrDash(r.cpc)}
      {num(r.meta_leads)}
      {curOrDash(r.meta_cpl)}
      {curOrDash(r.cpl)}
      {num(r.meta_purchases)}
    </>
  );
}

function CreativeCells({ r }: { r: AttributionRow }) {
  return (
    <>
      {cur(r.spend)}
      {num(r.impressions)}
      {num(r.video_p3_watched)}
      {pct(r.hook_rate, 1)}
      {num(r.video_play_actions)}
      {pct(r.video_play_rate, 1)}
      {num(r.unique_link_clicks)}
      {curOrDash(r.cost_per_link_click)}
    </>
  );
}

function AnomalyBanner({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">
        Yesterday vs 7-day baseline · {anomalies.length} anomaly{anomalies.length === 1 ? '' : 'ies'}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {anomalies.slice(0, 6).map((a) => {
          const tint =
            a.sentiment === 'bad'  ? 'bg-red-50      border-red-200      text-red-800'      :
            a.sentiment === 'good' ? 'bg-emerald-50  border-emerald-200  text-emerald-800'  :
                                     'bg-slate-50    border-slate-200    text-slate-800';
          const arrow = a.direction === 'up' ? '▲' : '▼';
          return (
            <div key={a.metric} className={`border rounded-lg p-3 ${tint}`}>
              <div className="text-xs uppercase tracking-wide opacity-75">{a.label}</div>
              <div className="mt-1 text-sm font-medium flex items-center gap-1.5">
                <span className="text-base">{arrow}</span>
                <span>{Math.abs(a.delta_pct * 100).toFixed(0)}%</span>
              </div>
              <p className="mt-1 text-xs opacity-90">{a.summary}</p>
            </div>
          );
        })}
      </div>
    </section>
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
