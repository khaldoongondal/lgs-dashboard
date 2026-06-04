import PageShell from '@/components/page-shell';
import StatCard from '@/components/stat-card';
import EmptyState from '@/components/empty-state';
import { resolveRange } from '@/lib/date-range';
import { fmtCurrency, fmtNumber } from '@/lib/format';
import { loadOpportunities, type OppFilter, type OppRow } from '@/lib/queries/opportunities';
import RefreshButton from './refresh-button';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SP {
  pipeline?: string; stage?: string; rep?: string; status?: string; q?: string;
  preset?: string; from?: string; to?: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
function relTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const STATUS_STYLE: Record<string, string> = {
  open:      'bg-blue-50 text-blue-700 border-blue-200',
  won:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  lost:      'bg-red-50 text-red-700 border-red-200',
  abandoned: 'bg-slate-100 text-slate-600 border-slate-200',
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400 text-xs">—</span>;
  const cls = STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}

export default async function SalesOpportunitiesPage({ searchParams }: { searchParams: SP }) {
  const range = resolveRange(searchParams);
  const filter: OppFilter = {
    pipeline: searchParams.pipeline || undefined,
    stage:    searchParams.stage    || undefined,
    rep:      searchParams.rep      || undefined,
    status:   searchParams.status   || undefined,
    q:        searchParams.q        || undefined,
  };

  const board = await loadOpportunities(filter);

  const openCount = board.byStatus.find((s) => s.status === 'open')?.count ?? 0;
  const wonCount  = board.byStatus.find((s) => s.status === 'won')?.count ?? 0;

  // Stage dropdown scoped to the selected pipeline (if one is chosen).
  const stageOptions = filter.pipeline
    ? board.stages.filter((s) => s.pipeline_id === filter.pipeline)
    : board.stages;

  const hasFilters = !!(filter.pipeline || filter.stage || filter.rep || filter.status || filter.q);

  return (
    <PageShell
      current="/sales-opportunities"
      title="Sales Opportunities"
      subtitle="Live GHL pipeline — where every lead is at"
      range={range}
      showDatePicker={false}
    >
      {/* Sync bar */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="text-xs text-slate-500">
          Last synced <span className="font-medium text-slate-700">{relTime(board.lastSynced)}</span>
          {board.lastSync?.status === 'error' && (
            <span className="ml-2 text-red-600">· last sync failed: {board.lastSync.error}</span>
          )}
        </div>
        <RefreshButton />
      </div>

      {!board.configured ? (
        <EmptyState
          title="GHL not configured"
          description="Set GHL_API_TOKEN and GHL_LOCATION_ID in the environment, then click Refresh from GHL."
        />
      ) : board.total === 0 && !board.lastSynced ? (
        <EmptyState
          title="No opportunities synced yet"
          description="Click “Refresh from GHL” above to pull your pipeline live."
        />
      ) : (
        <>
          {/* Summary */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <StatCard label="Opportunities"          value={fmtNumber(board.total)} />
            <StatCard label="Open"                   value={fmtNumber(openCount)} />
            <StatCard label="Pipeline Value (open)"  value={fmtCurrency(board.openValue)} />
            <StatCard label="Won"                    value={fmtNumber(wonCount)} />
          </section>

          {/* Stage breakdown */}
          {board.byStage.length > 0 && (
            <section className="mb-5">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">By stage</div>
              <div className="flex gap-2 flex-wrap">
                {board.byStage.map((s) => (
                  <div key={s.stage_id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="text-xs text-slate-500">{s.stage_name}</div>
                    <div className="text-sm font-semibold text-slate-900">
                      {fmtNumber(s.count)}
                      <span className="text-xs font-normal text-slate-400"> · {fmtCurrency(s.value)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Filter bar (GET form — server-rendered, no JS needed) */}
          <form method="get" className="flex items-end gap-2 flex-wrap mb-3">
            <FilterSelect name="pipeline" label="Pipeline" value={filter.pipeline} options={board.pipelines} allLabel="All pipelines" />
            <FilterSelect name="stage"    label="Stage"    value={filter.stage}    options={stageOptions}    allLabel="All stages" />
            <FilterSelect name="rep"      label="Owner"    value={filter.rep}      options={board.reps}      allLabel="All owners" />
            <FilterSelect name="status"   label="Status"   value={filter.status}
              options={board.statuses.map((s) => ({ value: s, label: s }))} allLabel="All statuses" />
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search</label>
              <input
                name="q"
                defaultValue={filter.q ?? ''}
                placeholder="name / email / phone"
                className="h-8 rounded-lg border border-slate-200 px-2 text-sm"
              />
            </div>
            <button type="submit" className="h-8 px-3 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500">
              Apply
            </button>
            {hasFilters && (
              <a href="/sales-opportunities" className="h-8 px-3 inline-flex items-center rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">
                Clear
              </a>
            )}
          </form>

          {/* Table */}
          <div className="card overflow-x-auto">
            {board.rows.length === 0 ? (
              <EmptyState title="No opportunities match these filters" description="Adjust or clear the filters above." />
            ) : (
              <table className="lgs-table">
                <thead>
                  <tr>
                    <th className="!text-left">Lead</th>
                    <th className="!text-left">Pipeline</th>
                    <th className="!text-left">Stage</th>
                    <th className="!text-left">Owner</th>
                    <th className="!text-left">Status</th>
                    <th className="!text-right">Value</th>
                    <th className="!text-right">Created</th>
                    <th className="!text-right">Updated</th>
                    <th className="!text-right">Days in stage</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((r) => <OppRowCells key={r.id} r={r} />)}
                </tbody>
              </table>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Showing {fmtNumber(board.rows.length)} opportunit{board.rows.length === 1 ? 'y' : 'ies'}
            {hasFilters ? ' (filtered)' : ''}. Read-only mirror of GHL — auto-synced hourly, or refresh live above.
          </p>
        </>
      )}
    </PageShell>
  );
}

function FilterSelect({ name, label, value, options, allLabel }: {
  name: string; label: string; value?: string;
  options: { value: string; label: string }[]; allLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</label>
      <select
        name={name}
        defaultValue={value ?? ''}
        className="h-8 rounded-lg border border-slate-200 px-2 text-sm bg-white max-w-[190px]"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function OppRowCells({ r }: { r: OppRow }) {
  const days = daysSince(r.last_stage_change_at || r.updated_at || r.created_at);
  const name = r.name || r.contact_name || '(unnamed)';
  const sub  = r.contact_email || r.contact_phone || '';
  return (
    <tr>
      <td className="font-medium text-slate-900">
        <div>{name}</div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
      </td>
      <td className="text-slate-700">{r.pipeline_name || '—'}</td>
      <td className="text-slate-700">{r.stage_name || '—'}</td>
      <td className="text-slate-700">{r.rep_name || <span className="text-slate-400">unassigned</span>}</td>
      <td><StatusPill status={r.status} /></td>
      <td className="text-right tabular-nums">{r.monetary_value != null ? fmtCurrency(Number(r.monetary_value)) : '—'}</td>
      <td className="text-right tabular-nums text-slate-600">{fmtDate(r.created_at)}</td>
      <td className="text-right tabular-nums text-slate-600">{fmtDate(r.updated_at)}</td>
      <td className="text-right tabular-nums">{days != null ? `${days}d` : '—'}</td>
    </tr>
  );
}
