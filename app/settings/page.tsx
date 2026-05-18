import PageShell from '@/components/page-shell';
import { resolveRange } from '@/lib/date-range';
import { maybeServiceClient } from '@/lib/supabase/server';
import { envStatus } from '@/lib/env';
import { fmtCurrency, fmtPct } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ExpenseRow {
  key:           string;
  scope:         string;
  month:         string | null;
  value_numeric: number | null;
  value_pct:     number | null;
  label:         string | null;
  notes:         string | null;
}

async function loadExpenses(): Promise<ExpenseRow[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('expense_config')
    .select('*')
    .order('scope', { ascending: true })
    .order('key',   { ascending: true });
  if (error) return [];
  return (data ?? []) as unknown as ExpenseRow[];
}

export default async function SettingsPage({ searchParams }: { searchParams: { preset?: string; from?: string; to?: string } }) {
  const range = resolveRange(searchParams);
  const expenses = await loadExpenses();
  const env = envStatus();

  return (
    <PageShell current="/settings" title="Settings"
      subtitle="Expense config + integration status"
      range={range} showDatePicker={false}>

      {/* Env / integration status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Supabase',      ok: env.supabase },
          { label: 'Auth',          ok: env.auth },
          { label: 'Meta CAPI',     ok: env.metaCapi },
          { label: 'GHL webhook',   ok: env.ghlWebhook },
        ].map((s) => (
          <div key={s.label} className="card-pad">
            <div className="text-xs uppercase tracking-wide text-slate-500">{s.label}</div>
            <div className="mt-2 flex items-center gap-2">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.ok ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className="text-sm font-medium text-slate-900">{s.ok ? 'Configured' : 'Not set'}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Expense config */}
      <div className="card overflow-x-auto">
        <div className="border-b border-slate-200 px-5 py-3">
          <div className="text-sm font-medium text-slate-900">Expense config</div>
          <p className="text-xs text-slate-500">Default values seeded from the planning doc. Inline editing coming soon.</p>
        </div>
        {expenses.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-500">
            Run <code>db/schema.sql</code> in Supabase — the table will pre-seed with defaults.
          </div>
        ) : (
          <table className="lgs-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Label</th>
                <th>Scope</th>
                <th>Month</th>
                <th className="!text-right">Value</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e, i) => (
                <tr key={i}>
                  <td className="font-mono text-xs text-slate-700">{e.key}</td>
                  <td>{e.label}</td>
                  <td>{e.scope}</td>
                  <td className="tabular-nums">{e.month ?? '—'}</td>
                  <td className="text-right tabular-nums">
                    {e.value_numeric != null ? fmtCurrency(e.value_numeric) :
                     e.value_pct     != null ? fmtPct(e.value_pct) : '—'}
                  </td>
                  <td className="text-slate-500">{e.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
}
