import Link from 'next/link';
import PageShell from '@/components/page-shell';
import EmptyState from '@/components/empty-state';
import { resolveRange } from '@/lib/date-range';
import { adByCloseRate, repBySource, campaignByLTV, campaignFunnel } from '@/lib/queries/insights';
import { maybeServiceClient } from '@/lib/supabase/server';
import { fmtCurrency, fmtNumber, fmtPct } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SP { preset?: string; from?: string; to?: string; source?: string; campaign?: string }

async function loadFilterOptions(): Promise<{ sources: string[]; campaigns: string[] }> {
  const sb = maybeServiceClient();
  if (!sb) return { sources: [], campaigns: [] };
  const [contactsRes, spendRes] = await Promise.all([
    sb.from('ghl_contacts').select('utm_source, utm_campaign'),
    sb.from('meta_ad_performance').select('campaign_name'),
  ]);
  const sources   = new Set<string>();
  const campaigns = new Set<string>();
  for (const c of contactsRes.data ?? []) {
    const cc = c as any;
    if (cc.utm_source)   sources.add(cc.utm_source);
    if (cc.utm_campaign) campaigns.add(cc.utm_campaign);
  }
  for (const c of spendRes.data ?? []) {
    const cc = c as any;
    if (cc.campaign_name) campaigns.add(cc.campaign_name);
  }
  return {
    sources:   Array.from(sources).sort(),
    campaigns: Array.from(campaigns).sort(),
  };
}

function buildHref(base: Partial<SP>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  return `/dashboard/insights?${sp.toString()}`;
}

export default async function InsightsPage({ searchParams }: { searchParams: SP }) {
  const range  = resolveRange(searchParams);
  const filter = { source: searchParams.source, campaign: searchParams.campaign };

  const [adClose, repSrc, campLtv, campFunnel, options] = await Promise.all([
    adByCloseRate(range.from, range.to, filter),
    repBySource(range.from, range.to, filter),
    campaignByLTV(),                                           // LTV ignores date range
    campaignFunnel(range.from, range.to, filter),
    loadFilterOptions(),
  ]);

  const baseParams: Partial<SP> = {
    preset: range.preset, from: range.from, to: range.to,
    source: filter.source, campaign: filter.campaign,
  };

  return (
    <PageShell current="/dashboard/insights" title="Cross-Layer Insights"
      subtitle={`${range.from} → ${range.to} · ad + funnel + sales joined`} range={range}>

      {/* Filters */}
      <div className="space-y-2 mb-5">
        <FilterRow
          label="Source"
          options={['', ...options.sources]}
          selected={filter.source ?? ''}
          buildHref={(v) => buildHref({ ...baseParams, source: v || undefined })}
        />
        <FilterRow
          label="Campaign"
          options={['', ...options.campaigns]}
          selected={filter.campaign ?? ''}
          buildHref={(v) => buildHref({ ...baseParams, campaign: v || undefined })}
        />
      </div>

      {/* 1. Ad × Close Rate */}
      <Section
        title="Which ad produces the highest close rate?"
        subtitle="Closes ÷ Leads per ad. Highest first."
        empty={adClose.length === 0}
      >
        <table className="lgs-table">
          <thead>
            <tr>
              <th className="!text-left">Campaign</th>
              <th className="!text-left">Ad</th>
              <th className="!text-right">Spend</th>
              <th className="!text-right">Leads</th>
              <th className="!text-right">Closes</th>
              <th className="!text-right">Close %</th>
              <th className="!text-right">CPL</th>
              <th className="!text-right">CAC</th>
              <th className="!text-right">Revenue</th>
              <th className="!text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {adClose.slice(0, 20).map((r, i) => (
              <tr key={`${r.campaign}-${r.ad_name}-${i}`}>
                <td className="text-slate-700">{r.campaign}</td>
                <td className="font-medium text-slate-900">{r.ad_name}</td>
                <td className="text-right tabular-nums">{fmtCurrency(r.spend)}</td>
                <td className="text-right tabular-nums">{fmtNumber(r.leads)}</td>
                <td className="text-right tabular-nums">{fmtNumber(r.closes)}</td>
                <td className="text-right tabular-nums">{fmtPct(r.close_rate)}</td>
                <td className="text-right tabular-nums">{r.cpl != null ? fmtCurrency(r.cpl) : '—'}</td>
                <td className="text-right tabular-nums">{r.cac != null ? fmtCurrency(r.cac) : '—'}</td>
                <td className="text-right tabular-nums">{fmtCurrency(r.revenue)}</td>
                <td className="text-right tabular-nums">{r.roas != null ? `${r.roas.toFixed(2)}x` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* 2. Rep × Source */}
      <Section
        title="Which rep converts best from each source?"
        subtitle="Closes ÷ Leads grouped by rep × source."
        empty={repSrc.length === 0}
      >
        <table className="lgs-table">
          <thead>
            <tr>
              <th className="!text-left">Rep</th>
              <th className="!text-left">Source</th>
              <th className="!text-right">Leads</th>
              <th className="!text-right">Closes</th>
              <th className="!text-right">Close %</th>
              <th className="!text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {repSrc.slice(0, 30).map((r, i) => (
              <tr key={`${r.rep_name}-${r.source}-${i}`}>
                <td className="font-medium text-slate-900">{r.rep_name}</td>
                <td className="text-slate-700">{r.source}</td>
                <td className="text-right tabular-nums">{fmtNumber(r.leads)}</td>
                <td className="text-right tabular-nums">{fmtNumber(r.closes)}</td>
                <td className="text-right tabular-nums">{fmtPct(r.close_rate)}</td>
                <td className="text-right tabular-nums">{fmtCurrency(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* 3. Campaign × LTV */}
      <Section
        title="Which campaign produces longest-tenure clients?"
        subtitle="MRR × tenure_months, averaged per campaign. Requires clients in /clients."
        empty={campLtv.length === 0}
        emptyDescription="No client rows yet. Once you mark contacts as clients on /clients, this lights up."
      >
        <table className="lgs-table">
          <thead>
            <tr>
              <th className="!text-left">Campaign</th>
              <th className="!text-right">Clients</th>
              <th className="!text-right">Active</th>
              <th className="!text-right">Total MRR</th>
              <th className="!text-right">Avg Tenure (mo)</th>
              <th className="!text-right">Avg LTV</th>
            </tr>
          </thead>
          <tbody>
            {campLtv.slice(0, 20).map((r) => (
              <tr key={r.campaign}>
                <td className="font-medium text-slate-900">{r.campaign}</td>
                <td className="text-right tabular-nums">{fmtNumber(r.clients)}</td>
                <td className="text-right tabular-nums">{fmtNumber(r.active_clients)}</td>
                <td className="text-right tabular-nums">{fmtCurrency(r.total_mrr)}</td>
                <td className="text-right tabular-nums">{r.avg_tenure != null ? r.avg_tenure.toFixed(1) : '—'}</td>
                <td className="text-right tabular-nums">{r.avg_ltv != null ? fmtCurrency(r.avg_ltv) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* 4. Campaign × Funnel */}
      <Section
        title="Where do leads drop off — Campaign A vs B?"
        subtitle="Side-by-side funnel for every campaign. Highest-volume first."
        empty={campFunnel.length === 0}
      >
        <table className="lgs-table">
          <thead>
            <tr>
              <th className="!text-left">Campaign</th>
              <th className="!text-right">Leads</th>
              <th className="!text-right">Booked</th>
              <th className="!text-right">Booking %</th>
              <th className="!text-right">Shown</th>
              <th className="!text-right">Show %</th>
              <th className="!text-right">Closes</th>
              <th className="!text-right">Close %</th>
            </tr>
          </thead>
          <tbody>
            {campFunnel.slice(0, 20).map((r) => (
              <tr key={r.campaign}>
                <td className="font-medium text-slate-900">{r.campaign}</td>
                <td className="text-right tabular-nums">{fmtNumber(r.leads)}</td>
                <td className="text-right tabular-nums">{fmtNumber(r.booked)}</td>
                <td className="text-right tabular-nums">{fmtPct(r.booking_rate)}</td>
                <td className="text-right tabular-nums">{fmtNumber(r.shown)}</td>
                <td className="text-right tabular-nums">{fmtPct(r.show_rate)}</td>
                <td className="text-right tabular-nums">{fmtNumber(r.closes)}</td>
                <td className="text-right tabular-nums">{fmtPct(r.close_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </PageShell>
  );
}

function FilterRow({
  label, options, selected, buildHref,
}: {
  label: string;
  options: string[];
  selected: string;
  buildHref: (v: string) => string;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-2 w-20">{label}</span>
      {options.map((v) => {
        const active = selected === v;
        return (
          <Link
            key={v || '__all'}
            href={buildHref(v)}
            className={[
              'px-2.5 py-1 rounded text-xs font-medium border',
              active ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
            ].join(' ')}
          >
            {v || 'All'}
          </Link>
        );
      })}
    </div>
  );
}

function Section({
  title, subtitle, empty, emptyDescription, children,
}: {
  title: string; subtitle?: string; empty: boolean; emptyDescription?: string; children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="card overflow-x-auto">
        {empty ? (
          <EmptyState
            title="No data yet"
            description={emptyDescription ?? "Try a wider date range or clear the filters."}
          />
        ) : children}
      </div>
    </div>
  );
}
