/**
 * Sales Opportunities reporting — reads the Supabase mirror of GHL
 * opportunities (populated by lib/ghl-sync). Read-only: filter by pipeline,
 * stage, owner, status, or free text; returns the rows plus summary rollups
 * and the option lists that drive the filter bar.
 */

import { maybeServiceClient } from '@/lib/supabase/server';
import { ghlConfigured } from '@/lib/ghl';

export interface OppFilter {
  pipeline?: string;   // pipeline_id
  stage?:    string;   // stage_id
  rep?:      string;   // assigned_to
  status?:   string;   // open | won | lost | abandoned
  q?:        string;   // free-text (name / email / phone)
}

export interface OppRow {
  id:                   string;
  name:                 string | null;
  status:               string | null;
  monetary_value:       number | null;
  pipeline_id:          string | null;
  pipeline_name:        string | null;
  stage_id:             string | null;
  stage_name:           string | null;
  stage_position:       number | null;
  assigned_to:          string | null;
  rep_name:             string | null;
  contact_id:           string | null;
  contact_name:         string | null;
  contact_email:        string | null;
  contact_phone:        string | null;
  source:               string | null;
  created_at:           string | null;
  updated_at:           string | null;
  last_stage_change_at: string | null;
}

export interface OppOption { value: string; label: string }
export interface StageOption extends OppOption { pipeline_id: string | null; position: number }

export interface OppBoard {
  configured:  boolean;
  rows:        OppRow[];
  total:       number;
  totalValue:  number;
  openValue:   number;
  byStatus:    { status: string; count: number; value: number }[];
  byStage:     { stage_id: string; stage_name: string; position: number; count: number; value: number }[];
  pipelines:   OppOption[];
  stages:      StageOption[];
  reps:        OppOption[];
  statuses:    string[];
  lastSynced:  string | null;
  lastSync:    { status: string; error: string | null } | null;
  filter:      OppFilter;
}

const STATUSES = ['open', 'won', 'lost', 'abandoned'];

export async function loadOpportunities(filter: OppFilter): Promise<OppBoard> {
  const base: OppBoard = {
    configured: ghlConfigured(),
    rows: [], total: 0, totalValue: 0, openValue: 0,
    byStatus: [], byStage: [], pipelines: [], stages: [], reps: [],
    statuses: STATUSES, lastSynced: null, lastSync: null, filter,
  };

  const sb = maybeServiceClient();
  if (!sb) return base;

  // Option lists + sync status (independent of the row filter).
  const [pipeRes, repRes, lastRes, logRes] = await Promise.all([
    sb.from('ghl_pipelines').select('id, name, stages').order('name'),
    sb.from('ghl_opportunities').select('assigned_to, rep_name'),
    sb.from('ghl_opportunities').select('synced_at').order('synced_at', { ascending: false }).limit(1),
    sb.from('sync_log').select('status, error_message, finished_at')
      .eq('source', 'ghl_opportunities').order('started_at', { ascending: false }).limit(1),
  ]);

  const pipelines: OppOption[] = (pipeRes.data ?? []).map((p: any) => ({ value: p.id, label: p.name || p.id }));
  const stages: StageOption[] = [];
  for (const p of (pipeRes.data ?? []) as any[]) {
    for (const s of p.stages ?? []) {
      stages.push({ value: s.id, label: s.name || s.id, pipeline_id: p.id, position: s.position ?? 0 });
    }
  }
  stages.sort((a, b) => a.position - b.position);

  const repMap = new Map<string, string>();
  for (const r of (repRes.data ?? []) as any[]) {
    if (r.assigned_to) repMap.set(r.assigned_to, r.rep_name || r.assigned_to);
  }
  const reps: OppOption[] = Array.from(repMap.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const lastSynced = (lastRes.data?.[0] as any)?.synced_at ?? null;
  const log = logRes.data?.[0] as any;
  const lastSync = log ? { status: log.status, error: log.error_message ?? null } : null;

  // Filtered rows for the table.
  let q = sb.from('ghl_opportunities').select('*').order('updated_at', { ascending: false }).limit(1000);
  if (filter.pipeline) q = q.eq('pipeline_id', filter.pipeline);
  if (filter.stage)    q = q.eq('stage_id', filter.stage);
  if (filter.rep)      q = q.eq('assigned_to', filter.rep);
  if (filter.status)   q = q.eq('status', filter.status);
  if (filter.q) {
    const term = filter.q.replace(/[%,()]/g, ' ').trim();
    if (term) {
      q = q.or(
        `name.ilike.%${term}%,contact_name.ilike.%${term}%,contact_email.ilike.%${term}%,contact_phone.ilike.%${term}%`,
      );
    }
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[opportunities] supabase error:', error.message);
    return { ...base, pipelines, stages, reps, lastSynced, lastSync };
  }

  const rows = (data ?? []) as unknown as OppRow[];

  let totalValue = 0, openValue = 0;
  const statusAgg = new Map<string, { count: number; value: number }>();
  const stageAgg  = new Map<string, { stage_name: string; position: number; count: number; value: number }>();
  for (const r of rows) {
    const v = Number(r.monetary_value) || 0;
    totalValue += v;
    if ((r.status ?? '') === 'open') openValue += v;

    const st = r.status || 'unknown';
    const sa = statusAgg.get(st) ?? { count: 0, value: 0 };
    sa.count++; sa.value += v; statusAgg.set(st, sa);

    const sid = r.stage_id || '(none)';
    const sg = stageAgg.get(sid) ?? {
      stage_name: r.stage_name || '(no stage)', position: r.stage_position ?? 999, count: 0, value: 0,
    };
    sg.count++; sg.value += v; stageAgg.set(sid, sg);
  }

  const byStatus = Array.from(statusAgg.entries())
    .map(([status, a]) => ({ status, ...a }))
    .sort((a, b) => b.count - a.count);
  const byStage = Array.from(stageAgg.entries())
    .map(([stage_id, a]) => ({ stage_id, ...a }))
    .sort((a, b) => a.position - b.position);

  return {
    configured: true,
    rows,
    total: rows.length,
    totalValue, openValue,
    byStatus, byStage,
    pipelines, stages, reps,
    statuses: STATUSES,
    lastSynced, lastSync,
    filter,
  };
}
