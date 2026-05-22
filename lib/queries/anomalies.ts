/**
 * Deterministic anomaly detection — compares the latest day to a rolling
 * 7-day baseline and flags KPIs that deviate by more than the threshold.
 *
 * No AI required (yet). When the Anthropic API key is wired in, a future
 * pass can ask Claude to write a one-line natural-language explanation per
 * anomaly. For now the cards are template-rendered.
 */

import { maybeServiceClient } from '@/lib/supabase/server';

export interface Anomaly {
  metric:     string;
  label:      string;
  latest:     number;
  baseline:   number;
  delta_pct:  number;            // (latest - baseline) / baseline
  direction:  'up' | 'down';
  /** Whether the move is good or bad given the KPI semantics. */
  sentiment:  'good' | 'bad' | 'neutral';
  summary:    string;
}

const THRESHOLD = 0.20;          // ≥20% deviation is interesting

interface DailyRollup {
  spend:        number;
  impressions:  number;
  clicks:       number;
  meta_leads:   number;
  video_p3:     number;
}

function emptyDay(): DailyRollup {
  return { spend: 0, impressions: 0, clicks: 0, meta_leads: 0, video_p3: 0 };
}

function cpl(d: DailyRollup): number | null { return d.meta_leads > 0 ? d.spend / d.meta_leads : null; }
function ctr(d: DailyRollup): number | null { return d.impressions > 0 ? d.clicks / d.impressions : null; }
function cpm(d: DailyRollup): number | null { return d.impressions > 0 ? (d.spend / d.impressions) * 1000 : null; }
function hook(d: DailyRollup): number | null { return d.impressions > 0 ? d.video_p3 / d.impressions : null; }

/** Average over days where the metric is non-null. */
function avgOf(days: DailyRollup[], fn: (d: DailyRollup) => number | null): number {
  const vals: number[] = [];
  for (const d of days) {
    const v = fn(d);
    if (v !== null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function classify(metric: string, direction: 'up' | 'down'): Anomaly['sentiment'] {
  // Whether a spike or drop is "good" depends on the KPI.
  switch (metric) {
    case 'spend':       return 'neutral';
    case 'impressions': return direction === 'up' ? 'good' : 'bad';
    case 'clicks':      return direction === 'up' ? 'good' : 'bad';
    case 'ctr':         return direction === 'up' ? 'good' : 'bad';
    case 'cpm':         return direction === 'down' ? 'good' : 'bad';
    case 'cpl':         return direction === 'down' ? 'good' : 'bad';
    case 'hook_rate':   return direction === 'up' ? 'good' : 'bad';
    case 'meta_leads':  return direction === 'up' ? 'good' : 'bad';
    default:            return 'neutral';
  }
}

function format(metric: string, value: number): string {
  if (['cpl', 'cpm', 'spend'].includes(metric)) return `$${value.toFixed(2)}`;
  if (['ctr', 'hook_rate'].includes(metric))    return `${(value * 100).toFixed(2)}%`;
  if (['impressions', 'clicks', 'meta_leads'].includes(metric)) return value.toFixed(0);
  return String(value);
}

export async function detectAnomalies(): Promise<Anomaly[]> {
  const sb = maybeServiceClient();
  if (!sb) return [];

  // Pull last 8 days of meta_ad_performance, summed per date.
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - 8 * 86_400_000);
  const fromISO = start.toISOString().slice(0, 10);
  const toISO   = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);   // yesterday

  const { data, error } = await sb
    .from('meta_ad_performance')
    .select('date, spend, impressions, clicks, meta_leads, video_p3_watched')
    .gte('date', fromISO).lte('date', toISO);
  if (error || !data) return [];

  const byDay = new Map<string, DailyRollup>();
  for (const r of data) {
    const rr = r as any;
    let d = byDay.get(rr.date);
    if (!d) { d = emptyDay(); byDay.set(rr.date, d); }
    d.spend       += Number(rr.spend)        || 0;
    d.impressions += Number(rr.impressions)  || 0;
    d.clicks      += Number(rr.clicks)       || 0;
    d.meta_leads  += Number(rr.meta_leads)   || 0;
    d.video_p3    += Number(rr.video_p3_watched) || 0;
  }
  if (byDay.size < 2) return [];

  const sortedDates = Array.from(byDay.keys()).sort();
  const latestDate = sortedDates[sortedDates.length - 1];
  const latest = byDay.get(latestDate)!;
  const baselineDays = sortedDates.slice(0, -1).map((k) => byDay.get(k)!);

  const checks: { metric: string; label: string; latest: number | null; baseline: number }[] = [
    { metric: 'spend',       label: 'Spend',       latest: latest.spend,             baseline: baselineDays.reduce((s, d) => s + d.spend,       0) / baselineDays.length },
    { metric: 'impressions', label: 'Impressions', latest: latest.impressions,       baseline: baselineDays.reduce((s, d) => s + d.impressions, 0) / baselineDays.length },
    { metric: 'clicks',      label: 'Clicks',      latest: latest.clicks,            baseline: baselineDays.reduce((s, d) => s + d.clicks,      0) / baselineDays.length },
    { metric: 'meta_leads',  label: 'Meta Leads',  latest: latest.meta_leads,        baseline: baselineDays.reduce((s, d) => s + d.meta_leads,  0) / baselineDays.length },
    { metric: 'ctr',         label: 'CTR',         latest: ctr(latest),              baseline: avgOf(baselineDays, ctr) },
    { metric: 'cpm',         label: 'CPM',         latest: cpm(latest),              baseline: avgOf(baselineDays, cpm) },
    { metric: 'cpl',         label: 'CPL',         latest: cpl(latest),              baseline: avgOf(baselineDays, cpl) },
    { metric: 'hook_rate',   label: 'Hook Rate',   latest: hook(latest),             baseline: avgOf(baselineDays, hook) },
  ];

  const anomalies: Anomaly[] = [];
  for (const c of checks) {
    if (c.latest === null || c.baseline === 0) continue;
    const delta = (c.latest - c.baseline) / c.baseline;
    if (Math.abs(delta) < THRESHOLD) continue;
    const direction = delta > 0 ? 'up' : 'down';
    const sentiment = classify(c.metric, direction);
    const verb = direction === 'up' ? 'jumped' : 'dropped';
    const pct  = Math.abs(delta * 100);
    anomalies.push({
      metric:    c.metric,
      label:     c.label,
      latest:    c.latest,
      baseline:  c.baseline,
      delta_pct: delta,
      direction,
      sentiment,
      summary:   `${c.label} ${verb} ${pct.toFixed(0)}% on ${latestDate} — ${format(c.metric, c.latest)} vs ${format(c.metric, c.baseline)} (7d avg).`,
    });
  }

  // Sort: bad first, then good, then neutral; within each, largest delta first.
  const order: Record<Anomaly['sentiment'], number> = { bad: 0, good: 1, neutral: 2 };
  anomalies.sort((a, b) => order[a.sentiment] - order[b.sentiment] || Math.abs(b.delta_pct) - Math.abs(a.delta_pct));

  return anomalies;
}
