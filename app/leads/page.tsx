import Link from 'next/link';
import PageShell from '@/components/page-shell';
import EmptyState from '@/components/empty-state';
import ExportButton from '@/components/export-button';
import { loadLeadList } from '@/lib/queries/lead';
import { resolveRange } from '@/lib/date-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-CA', { dateStyle: 'short', timeStyle: 'short' });
}

export default async function LeadsPage({ searchParams }: { searchParams: { preset?: string; from?: string; to?: string } }) {
  const range = resolveRange(searchParams);
  const rows  = await loadLeadList(200);

  return (
    <PageShell current="/leads" title="Leads" subtitle="Recent contacts — click any row for the full journey" range={range} showDatePicker={false}>
      <div className="flex justify-end mb-3">
        <ExportButton table="leads" from={range.from} to={range.to} />
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title="No leads yet"
            description="GHL webhooks aren't firing. See docs/ghl-setup.md."
          />
        ) : (
          <table className="lgs-table">
            <thead>
              <tr>
                <th className="!text-left">Name</th>
                <th className="!text-left">Email</th>
                <th className="!text-left">Phone</th>
                <th className="!text-left">Source</th>
                <th className="!text-left">Campaign</th>
                <th className="!text-left">fbclid?</th>
                <th className="!text-right">Opted in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '(unknown)';
                return (
                  <tr key={r.id}>
                    <td className="font-medium text-slate-900">
                      <Link href={`/leads/${r.id}`} className="text-indigo-600 hover:underline">
                        {name}
                      </Link>
                    </td>
                    <td className="text-slate-700">{r.email || '—'}</td>
                    <td className="text-slate-700 tabular-nums">{r.phone || '—'}</td>
                    <td className="text-slate-700">{r.utm_source || '(direct)'}</td>
                    <td className="text-slate-700">{r.utm_campaign || '(no campaign)'}</td>
                    <td>
                      {r.fbclid
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">yes</span>
                        : <span className="text-slate-400 text-xs">no</span>}
                    </td>
                    <td className="text-right text-slate-700 tabular-nums">{fmtDate(r.opted_in_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-4 text-xs text-slate-500">Showing up to 200 most recent. Click a name for journey + CAPI events + Clarity session.</p>
    </PageShell>
  );
}
