import Link from 'next/link';
import PageShell from '@/components/page-shell';
import EmptyState from '@/components/empty-state';
import { resolveRange } from '@/lib/date-range';
import { maybeServiceClient } from '@/lib/supabase/server';
import { fmtNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SP { preset?: string; from?: string; to?: string; status?: string; event?: string }

interface CapiRow {
  id:               number;
  event_id:         string;
  event_name:       string;
  event_time:       string;
  source:           string;
  contact_id:       number | null;
  sent_ok:          boolean;
  last_error:       string | null;
  match_keys_sent:  string[] | null;
  response:         any;
  attempts:         number;
}

async function loadCapiEvents(from: string, to: string, filter: { status?: string; event?: string }): Promise<CapiRow[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];
  const toEnd = `${to}T23:59:59.999Z`;

  let query = sb.from('capi_event_log').select('*')
    .gte('event_time', from).lte('event_time', toEnd)
    .order('event_time', { ascending: false })
    .limit(500);

  if (filter.status === 'ok')   query = query.eq('sent_ok', true);
  if (filter.status === 'fail') query = query.eq('sent_ok', false);
  if (filter.event)             query = query.eq('event_name', filter.event);

  const { data, error } = await query;
  if (error) {
    console.warn('[capi-log] error:', error.message);
    return [];
  }
  return (data ?? []) as unknown as CapiRow[];
}

function buildHref(base: Partial<SP>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  return `/dashboard/capi-log?${sp.toString()}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-CA', { dateStyle: 'short', timeStyle: 'medium' });
}

export default async function CapiLogPage({ searchParams }: { searchParams: SP }) {
  const range  = resolveRange(searchParams);
  const status = searchParams.status || 'all';
  const event  = searchParams.event  || '';

  const rows = await loadCapiEvents(range.from, range.to, { status, event });

  // Stats for the top strip
  const totalSent     = rows.length;
  const okCount       = rows.filter((r) => r.sent_ok).length;
  const failCount     = totalSent - okCount;
  const okRate        = totalSent > 0 ? (okCount / totalSent) : null;
  const byEvent       = new Map<string, number>();
  for (const r of rows) byEvent.set(r.event_name, (byEvent.get(r.event_name) ?? 0) + 1);

  const baseParams: Partial<SP> = { preset: range.preset, from: range.from, to: range.to };

  return (
    <PageShell current="/dashboard/capi-log" title="CAPI Event Log"
      subtitle={`${range.from} → ${range.to} · every event sent to Meta`} range={range}>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Total events"   value={fmtNumber(totalSent)} />
        <Stat label="Successful"     value={fmtNumber(okCount)}    accent="success" />
        <Stat label="Failed"         value={fmtNumber(failCount)}  accent={failCount > 0 ? 'danger' : undefined} />
        <Stat label="OK rate"        value={okRate !== null ? `${(okRate*100).toFixed(1)}%` : '—'} />
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-2">Status</span>
        {[
          { v: 'all',  label: 'All'   },
          { v: 'ok',   label: 'OK'    },
          { v: 'fail', label: 'Failed' },
        ].map((s) => (
          <Link
            key={s.v}
            href={buildHref({ ...baseParams, status: s.v === 'all' ? undefined : s.v, event: event || undefined })}
            className={[
              'px-3 py-1.5 rounded-lg text-xs font-medium border',
              (status === s.v) ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
            ].join(' ')}
          >
            {s.label}
          </Link>
        ))}

        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 ml-4 mr-2">Event</span>
        {['', ...Array.from(byEvent.keys())].map((ev) => (
          <Link
            key={ev || 'all'}
            href={buildHref({ ...baseParams, status: status === 'all' ? undefined : status, event: ev || undefined })}
            className={[
              'px-3 py-1.5 rounded-lg text-xs font-medium border',
              (event === ev) ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
            ].join(' ')}
          >
            {ev || 'All'}{ev && byEvent.has(ev) ? ` (${byEvent.get(ev)})` : ''}
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState
            title="No CAPI events in this range"
            description="Every event our server sends to Meta via /api/webhooks/ghl is logged here. Once GHL is wired, this lights up."
          />
        ) : (
          <table className="lgs-table">
            <thead>
              <tr>
                <th className="!text-left">Time</th>
                <th className="!text-left">Event</th>
                <th className="!text-left">Source</th>
                <th className="!text-left">Status</th>
                <th className="!text-left">Match keys</th>
                <th className="!text-right">Received</th>
                <th className="!text-left">Contact</th>
                <th className="!text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const emqHint = guessEmqBand(r.match_keys_sent);
                return (
                  <tr key={r.id}>
                    <td className="text-slate-700 tabular-nums whitespace-nowrap">{fmtTime(r.event_time)}</td>
                    <td className="font-medium text-slate-900">{r.event_name}</td>
                    <td className="text-slate-600 text-xs">{r.source}</td>
                    <td>
                      {r.sent_ok ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">ok</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border bg-red-50 text-red-700 border-red-200">failed</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(r.match_keys_sent ?? []).map((k) => (
                          <span key={k} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">{k}</span>
                        ))}
                        {emqHint && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${emqHint.cls}`}>
                            EMQ ~{emqHint.score}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{r.response?.events_received ?? '—'}</td>
                    <td>
                      {r.contact_id ? (
                        <Link href={`/leads/${r.contact_id}`} className="text-brand-700 hover:underline text-xs">View →</Link>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="text-red-600 text-xs max-w-xs truncate" title={r.last_error || ''}>{r.last_error || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        EMQ score is inferred from the match_keys_sent array — Meta's actual score is in Events Manager and may differ.
        Recommended floor: <span className="font-mono">[em, ph, fn, ln, client_ip_address, client_user_agent]</span>.
      </p>
    </PageShell>
  );
}

/** Heuristic — Meta's real EMQ is computed server-side, but we can estimate. */
function guessEmqBand(keys: string[] | null): { score: string; cls: string } | null {
  if (!keys || keys.length === 0) return null;
  const present = new Set(keys);
  const has = (k: string) => present.has(k);
  let score = 3;
  if (has('em')) score += 2;
  if (has('ph')) score += 1;
  if (has('fn') && has('ln')) score += 1;
  if (has('client_ip_address') && has('client_user_agent')) score += 1;
  if (has('fbc') || has('fbp')) score += 1;
  if (has('ct') || has('country')) score += 0.5;
  const rounded = Math.min(score, 10);
  let cls = 'bg-red-50 text-red-700 border-red-200';
  if (rounded >= 7.5) cls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  else if (rounded >= 5) cls = 'bg-amber-50 text-amber-700 border-amber-200';
  return { score: rounded.toFixed(1), cls };
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'success' | 'danger' }) {
  const tone =
    accent === 'success' ? 'text-emerald-700' :
    accent === 'danger'  ? 'text-red-700' :
                           'text-slate-900';
  return (
    <div className="card-pad">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
