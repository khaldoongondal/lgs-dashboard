/**
 * Pull GHL pipelines + users + opportunities and mirror them into Supabase,
 * denormalized (pipeline/stage/rep names resolved at sync time) so the
 * Sales Opportunities dashboard is a pure filtered SELECT.
 *
 * Called by:
 *   - GET /api/cron/ghl-opportunities  (scheduled / manual with CRON_SECRET)
 *   - the "Refresh from GHL" button on /sales-opportunities (server action)
 */

import { serviceClient } from '@/lib/supabase/server';
import {
  fetchPipelines, fetchUsers, fetchAllOpportunities, ghlConfigured,
} from '@/lib/ghl';

export interface OppSyncResult {
  ok: boolean;
  pipelines: number;
  opportunities: number;
  error?: string;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function syncOpportunities(): Promise<OppSyncResult> {
  if (!ghlConfigured()) {
    return { ok: false, pipelines: 0, opportunities: 0, error: 'GHL_API_TOKEN / GHL_LOCATION_ID not set' };
  }

  const sb = serviceClient();
  const now = () => new Date().toISOString();

  // Open a sync_log row so failures are diagnosable from the DB.
  let logId: number | null = null;
  try {
    const { data } = await sb.from('sync_log')
      .insert({ source: 'ghl_opportunities', status: 'running' })
      .select('id').single();
    logId = (data as any)?.id ?? null;
  } catch { /* sync_log is best-effort */ }

  try {
    const [pipelines, users] = await Promise.all([fetchPipelines(), fetchUsers()]);

    if (pipelines.length) {
      await sb.from('ghl_pipelines').upsert(
        pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages, raw: p.raw, synced_at: now() })),
        { onConflict: 'id' },
      );
    }

    // Lookups for denormalization.
    const stageById = new Map<string, { name: string | null; position: number }>();
    const pipelineNameById = new Map<string, string | null>();
    for (const p of pipelines) {
      pipelineNameById.set(p.id, p.name);
      for (const s of p.stages) stageById.set(s.id, { name: s.name, position: s.position });
    }
    const userById = new Map(users.map((u) => [u.id, u]));

    const opps = await fetchAllOpportunities();

    const rows = opps.map((o: any) => {
      const stage   = o.pipelineStageId ? stageById.get(o.pipelineStageId) : undefined;
      const user    = o.assignedTo ? userById.get(o.assignedTo) : undefined;
      const contact = o.contact ?? {};
      const contactName =
        contact.name ?? ([contact.firstName, contact.lastName].filter(Boolean).join(' ') || null);
      return {
        id:                    o.id,
        name:                  o.name ?? contactName ?? null,
        status:                o.status ?? null,
        monetary_value:        num(o.monetaryValue),
        pipeline_id:           o.pipelineId ?? null,
        pipeline_name:         (o.pipelineId ? pipelineNameById.get(o.pipelineId) : null) ?? null,
        stage_id:              o.pipelineStageId ?? null,
        stage_name:            stage?.name ?? null,
        stage_position:        stage?.position ?? null,
        assigned_to:           o.assignedTo ?? null,
        rep_name:              user?.name ?? null,
        rep_email:             user?.email ?? null,
        contact_id:            o.contactId ?? contact.id ?? null,
        contact_name:          contactName,
        contact_email:         contact.email ?? null,
        contact_phone:         contact.phone ?? null,
        source:                o.source ?? null,
        created_at:            o.createdAt ?? null,
        updated_at:            o.updatedAt ?? null,
        last_status_change_at: o.lastStatusChangeAt ?? null,
        last_stage_change_at:  o.lastStageChangeAt ?? null,
        raw:                   o,
        synced_at:             now(),
      };
    });

    let written = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await sb.from('ghl_opportunities').upsert(chunk, { onConflict: 'id' });
      if (error) throw new Error(error.message);
      written += chunk.length;
    }

    if (logId != null) {
      await sb.from('sync_log').update({
        finished_at: now(), status: 'ok', rows_inserted: written,
        metadata: { pipelines: pipelines.length, users: users.length, opportunities: written },
      }).eq('id', logId);
    }

    return { ok: true, pipelines: pipelines.length, opportunities: written };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logId != null) {
      try { await sb.from('sync_log').update({ finished_at: now(), status: 'error', error_message: msg }).eq('id', logId); }
      catch { /* ignore */ }
    }
    return { ok: false, pipelines: 0, opportunities: 0, error: msg };
  }
}
