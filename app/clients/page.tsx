import Link from 'next/link';
import PageShell from '@/components/page-shell';
import StatCard from '@/components/stat-card';
import EmptyState from '@/components/empty-state';
import ExportButton from '@/components/export-button';
import { loadClients, type ClientStatus } from '@/lib/queries/clients';
import { resolveRange } from '@/lib/date-range';
import { fmtCurrency, fmtNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SP { preset?: string; from?: string; to?: string; status?: string }

const STATUSES: { v: ClientStatus | 'all'; label: string }[] = [
  { v: 'all',     label: 'All'      },
  { v: 'active',  label: 'Active'   },
  { v: 'at_risk', label: 'At Risk'  },
  { v: 'churned', label: 'Churned'  },
  { v: 'paused',  label: 'Paused'   },
];

function buildHref(base: Partial<SP>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  return `/clients?${sp.toString()}`;
}

const STATUS_TINT: Record<ClientStatus, string> = {
  active:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  at_risk: 'bg-amber-50   text-amber-700   border-amber-200',
  churned: 'bg-red-50     text-red-700     border-red-200',
  paused:  'bg-slate-100  text-slate-700   border-slate-200',
};

export default async function ClientsPage({ searchParams }: { searchParams: SP }) {
  const range = resolveRange(searchParams);
  const status = (searchParams.status as ClientStatus | 'all') || 'all';
  const { rows, by_status, total_mrr, total_ltv, avg_tenure } =
    await loadClients({ status });

  const baseParams: Partial<SP> = { preset: range.preset, from: range.from, to: range.to };

  return (
    <PageShell current="/clients" title="Clients"
      subtitle="Active book of business + LTV + churn" range={range} showDatePicker={false}>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Clients" value={fmtNumber(by_status.active)}
                  hint={`${by_status.at_risk} at risk · ${by_status.churned} churned`} />
        <StatCard label="Total MRR"      value={fmtCurrency(total_mrr)}
                  accent={total_mrr > 0 ? 'success' : 'default'} />
        <StatCard label="Avg Tenure"     value={avg_tenure != null ? `${avg_tenure.toFixed(1)} mo` : '—'} />
        <StatCard label="Total LTV"      value={fmtCurrency(total_ltv)} />
      </section>

      {/* Status filter + Export */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-2">Status</span>
          {STATUSES.map((s) => {
          const active = status === s.v;
          const count = s.v === 'all'
            ? rows.length
            : (by_status[s.v as ClientStatus] ?? 0);
          return (
            <Link
              key={s.v}
              href={buildHref({ ...baseParams, status: s.v === 'all' ? undefined : s.v })}
              className={[
                'px-3 py-1.5 rounded-lg text-xs font-medium border',
                active ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
              ].join(' ')}
            >
              {s.label}{count > 0 ? ` (${count})` : ''}
            </Link>
          );
        })}
        </div>
        <ExportButton table="clients" />
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title="No clients yet"
            description="Clients get auto-created when a Purchase event fires via GHL webhook. Wire ?type=purchase and the first sale populates this table."
          />
        ) : (
          <table className="lgs-table">
            <thead>
              <tr>
                <th className="!text-left">Client</th>
                <th className="!text-left">Status</th>
                <th className="!text-left">Started</th>
                <th className="!text-right">Tenure (mo)</th>
                <th className="!text-right">MRR</th>
                <th className="!text-right">LTV</th>
                <th className="!text-left">Campaign</th>
                <th className="!text-left">Ad</th>
                <th className="!text-left">Rep</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || r.ghl_contact_id;
                return (
                  <tr key={r.id}>
                    <td className="font-medium text-slate-900">
                      {r.contact_id ? (
                        <Link href={`/leads/${r.contact_id}`} className="text-brand-700 hover:underline">{name}</Link>
                      ) : name}
                    </td>
                    <td>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${STATUS_TINT[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="text-slate-700 tabular-nums">{new Date(r.started_at).toISOString().slice(0,10)}</td>
                    <td className="text-right tabular-nums">{r.tenure_months != null ? r.tenure_months.toFixed(1) : '—'}</td>
                    <td className="text-right tabular-nums">{fmtCurrency(r.mrr_value)}</td>
                    <td className="text-right tabular-nums font-medium">{r.ltv != null ? fmtCurrency(r.ltv) : '—'}</td>
                    <td className="text-slate-700">{r.attributed_campaign || '—'}</td>
                    <td className="text-slate-700">{r.attributed_ad || '—'}</td>
                    <td className="text-slate-700">{r.rep_name || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        LTV = MRR × tenure (months). Active-client tenure is computed live from started_at.
      </p>
    </PageShell>
  );
}
