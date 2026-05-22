import Link from 'next/link';
import PageShell from '@/components/page-shell';
import { loadLeadJourney, type JourneyEvent } from '@/lib/queries/lead';
import { resolveRange } from '@/lib/date-range';
import { fmtCurrency } from '@/lib/format';
import { notFound } from 'next/navigation';
import { updateLead } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-CA', { dateStyle: 'short', timeStyle: 'short' });
}

const KIND_STYLES: Record<JourneyEvent['kind'], { dot: string; label: string; tint: string }> = {
  pageview: { dot: 'bg-orange-500',  label: 'PAGE',  tint: 'bg-orange-50  text-orange-700  border-orange-200'  },
  pipeline: { dot: 'bg-emerald-500', label: 'PIPE',  tint: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  capi:     { dot: 'bg-indigo-500',  label: 'CAPI',  tint: 'bg-indigo-50  text-indigo-700  border-indigo-200'  },
};

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const j = await loadLeadJourney(id);
  if (!j) notFound();

  const name = [j.contact.first_name, j.contact.last_name].filter(Boolean).join(' ') || '(unknown)';
  const range = resolveRange({});

  return (
    <PageShell current="/leads" title={name} subtitle={`Contact #${j.contact.id} · GHL ${j.contact.ghl_contact_id ?? '—'}`} range={range} showDatePicker={false}>

      <div className="mb-4">
        <Link href="/leads" className="text-xs text-slate-500 hover:underline">← Back to all leads</Link>
      </div>

      {/* Identity card */}
      <div className="card-pad mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Field label="Email"  value={j.contact.email} />
          <Field label="Phone"  value={j.contact.phone} />
          <Field label="Opted in" value={j.contact.opted_in_at ? fmtTime(j.contact.opted_in_at) : null} />
          <Field label="Clarity session" value={
            j.contact.clarity_session_url
              ? <a href={j.contact.clarity_session_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Watch ↗</a>
              : null
          } />
        </div>
      </div>

      {/* Attribution + Origin */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="card-pad">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">Attribution</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Source"   value={j.contact.utm_source} />
            <Field label="Medium"   value={j.contact.utm_medium} />
            <Field label="Campaign" value={j.contact.utm_campaign} />
            <Field label="Adset (term)" value={j.contact.utm_term} />
            <Field label="Ad (content)" value={j.contact.utm_content} />
            <Field label="fbclid"   value={j.contact.fbclid} mono />
            <Field label="Fingerprint" value={j.contact.fingerprint} mono />
          </div>
        </div>
        <div className="card-pad">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">Origin (first page view)</div>
          {j.origin ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Landing page" value={j.origin.page_url} mono />
              <Field label="Referrer"     value={j.origin.referrer} mono />
              <Field label="Device"       value={j.origin.device_type} />
              <Field label="Browser"      value={j.origin.browser} />
              <Field label="OS"           value={j.origin.os} />
              <Field label="Location"     value={[j.origin.city, j.origin.region, j.origin.country].filter(Boolean).join(', ')} />
            </div>
          ) : (
            <p className="text-sm text-slate-500">No page view recorded for this contact yet.</p>
          )}
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Counter label="Page Views"      value={j.page_view_count}      color="orange" />
        <Counter label="Pipeline Events" value={j.pipeline_event_count} color="emerald" />
        <Counter label="CAPI Events"     value={j.capi_event_count}     color="indigo" />
      </div>

      {/* Editable notes + status */}
      <form action={updateLead} className="card-pad mb-4">
        <input type="hidden" name="id" value={j.contact.id} />
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</div>
          <select
            name="lead_status"
            defaultValue={j.contact.lead_status ?? ''}
            className="px-2 py-1 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">— none —</option>
            <option value="new">new</option>
            <option value="contacted">contacted</option>
            <option value="qualified">qualified</option>
            <option value="unqualified">unqualified</option>
            <option value="nurturing">nurturing</option>
            <option value="closed_won">closed_won</option>
            <option value="closed_lost">closed_lost</option>
          </select>
          <button
            type="submit"
            className="ml-auto px-3 py-1.5 text-xs font-medium rounded bg-slate-900 text-white hover:bg-slate-700"
          >
            Save
          </button>
        </div>
        <textarea
          name="notes"
          rows={4}
          defaultValue={j.contact.notes ?? ''}
          placeholder="Notes about this lead — sales-call recap, objections, next steps…"
          className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
        />
      </form>

      {/* Timeline */}
      <div className="card mb-4">
        <div className="px-4 pt-4 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Customer Journey
        </div>
        {j.events.length === 0 ? (
          <div className="px-4 pb-4 text-sm text-slate-500">No events for this contact yet.</div>
        ) : (
          <ol className="px-4 pb-4 space-y-3 relative before:absolute before:left-[26px] before:top-3 before:bottom-3 before:w-px before:bg-slate-200">
            {j.events.map((e, i) => {
              const s = KIND_STYLES[e.kind];
              return (
                <li key={`${e.kind}-${e.event_id}-${i}`} className="relative pl-12">
                  <div className={`absolute left-[20px] top-1 w-3.5 h-3.5 rounded-full ${s.dot} border-2 border-white ring-2 ring-slate-100`} />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${s.tint}`}>
                      {s.label}
                    </span>
                    <span className="font-medium text-slate-900 text-sm">{e.event_name}</span>
                    <span className="text-xs text-slate-500">{fmtTime(e.event_time)}</span>
                  </div>
                  <EventDetail event={e} />
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </PageShell>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 ${mono ? 'font-mono text-[11px] break-all' : 'text-sm'} text-slate-900`}>
        {value ?? <span className="text-slate-400">—</span>}
      </div>
    </div>
  );
}

const COUNTER_COLOR: Record<string, string> = {
  orange:  'border-orange-200  bg-orange-50  text-orange-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  indigo:  'border-indigo-200  bg-indigo-50  text-indigo-700',
};

function Counter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`border rounded-lg p-3 ${COUNTER_COLOR[color]}`}>
      <div className="text-xs uppercase tracking-wide opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function EventDetail({ event }: { event: JourneyEvent }) {
  const m = (event.meta ?? {}) as Record<string, any>;
  if (event.kind === 'pageview') {
    return (
      <div className="mt-1 text-xs text-slate-600 space-y-0.5">
        {m.page_url      != null && <div>URL: <span className="font-mono text-[11px] break-all">{String(m.page_url)}</span></div>}
        {m.page_slug     != null && <div>Slug: <span className="font-mono text-[11px]">{String(m.page_slug)}</span></div>}
        {(m.device_type || m.browser || m.os) && <div>Device: {String(m.device_type)} · {String(m.browser)} · {String(m.os)}</div>}
        {(m.city || m.region || m.country) && <div>Geo: {[m.city, m.region, m.country].filter(Boolean).join(', ')}</div>}
      </div>
    );
  }
  if (event.kind === 'pipeline') {
    return (
      <div className="mt-1 text-xs text-slate-600 space-y-0.5">
        {m.rep_name && <div>Rep: <span className="text-slate-900 font-medium">{String(m.rep_name)}</span></div>}
        {m.pipeline_stage && <div>Stage: {String(m.pipeline_stage)}</div>}
        {m.deal_value != null && Number(m.deal_value) > 0 &&
          <div>Deal value: <span className="text-slate-900 font-medium">{fmtCurrency(Number(m.deal_value))}</span></div>}
      </div>
    );
  }
  // capi
  return (
    <div className="mt-1 text-xs text-slate-600 space-y-0.5">
      <div>Source: {String(m.source ?? '—')} · Sent: {m.sent_ok ? 'ok' : 'failed'} · Received by Meta: {m.events_received ?? '—'}</div>
      {Array.isArray(m.match_keys_sent) && (
        <div>Match keys: <span className="font-mono text-[11px]">[{(m.match_keys_sent as string[]).join(', ')}]</span></div>
      )}
      {m.last_error && <div className="text-red-600">Error: {String(m.last_error)}</div>}
    </div>
  );
}
