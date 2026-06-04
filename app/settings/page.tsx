import PageShell from '@/components/page-shell';
import { resolveRange } from '@/lib/date-range';
import { maybeServiceClient } from '@/lib/supabase/server';
import { envStatus } from '@/lib/env';
import { updateExpenseConfig } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ExpenseRow {
  id:            number;
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
    .order('id', { ascending: true });
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
          { label: 'GA4',           ok: env.ga4 },
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

      {/* Expense config — editable */}
      <div className="card overflow-x-auto">
        <div className="border-b border-slate-200 px-5 py-3">
          <div className="text-sm font-medium text-slate-900">Expense config</div>
          <p className="text-xs text-slate-500">
            Changes apply immediately — Sales / Financials pages recompute on next load.
            Percent values: enter as % (e.g. <code>12.5</code> for 12.5%).
          </p>
        </div>
        {expenses.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-500">
            No expense_config rows. Insert defaults manually in Supabase.
          </div>
        ) : (
          <table className="lgs-table">
            <thead>
              <tr>
                <th className="!text-left">Key</th>
                <th className="!text-left">Label</th>
                <th className="!text-right">Value</th>
                <th className="!text-left">Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => {
                const isPct = e.value_pct != null;
                const displayValue = isPct
                  ? (Number(e.value_pct) * 100).toFixed(2)
                  : (e.value_numeric != null ? Number(e.value_numeric).toString() : '');

                return (
                  <tr key={e.id}>
                    <td className="font-mono text-xs text-slate-700">{e.key}</td>
                    <td>{e.label}</td>
                    <td className="text-right">
                      <form action={updateExpenseConfig} className="inline-flex items-center gap-1">
                        <input type="hidden" name="id"   value={e.id} />
                        <input type="hidden" name="kind" value={isPct ? 'pct' : 'numeric'} />
                        <input
                          type="number"
                          step="0.01"
                          name="value"
                          defaultValue={displayValue}
                          className="w-24 px-2 py-1 rounded border border-slate-200 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400"
                        />
                        <span className="text-xs text-slate-500 w-4">{isPct ? '%' : '$'}</span>
                        <button
                          type="submit"
                          className="ml-1 px-2 py-1 text-xs font-medium rounded-lg bg-brand text-white hover:bg-brand-700"
                        >
                          Save
                        </button>
                      </form>
                    </td>
                    <td className="text-slate-500 text-xs">{e.notes ?? ''}</td>
                    <td className="text-slate-400 text-xs">{e.scope}{e.month ? ` · ${e.month}` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
}
