/**
 * Minimal GoHighLevel API v2 client (services.leadconnectorhq.com).
 *
 * Auth: a Private Integration / API v2 token in GHL_API_TOKEN, plus the
 * GHL_LOCATION_ID of the sub-account. Every request sends:
 *   Authorization: Bearer <token>
 *   Version: <GHL_API_VERSION>   (default 2021-07-28)
 *
 * We only READ here — pipelines, users, and opportunities — for the read-only
 * Sales Opportunities dashboard. Opportunities use the classic
 * `GET /opportunities/search` (still functional; the newer advanced variant is
 * `POST /opportunities/search` with Version 2023-02-21 — swap fetchAllOpportunities
 * if/when you migrate).
 */

import { env } from '@/lib/env';

const GHL_BASE = 'https://services.leadconnectorhq.com';

export function ghlConfigured(): boolean {
  return !!env.ghlApiToken() && !!env.ghlLocationId();
}

function ghlHeaders(): HeadersInit {
  const token = env.ghlApiToken();
  if (!token) throw new Error('GHL_API_TOKEN not set');
  return {
    Authorization: `Bearer ${token}`,
    Version:       env.ghlApiVersion(),
    Accept:        'application/json',
  };
}

async function ghlGet(url: string): Promise<any> {
  const res = await fetch(url, { headers: ghlHeaders(), signal: AbortSignal.timeout(20_000) });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = body?.message ?? body?.error ?? `HTTP ${res.status}`;
    throw new Error(`GHL ${res.status}: ${Array.isArray(m) ? m.join('; ') : m}`);
  }
  return body;
}

// ── Pipelines ────────────────────────────────────────────────────────────────
export interface GhlStage { id: string; name: string | null; position: number }
export interface GhlPipeline { id: string; name: string | null; stages: GhlStage[]; raw: any }

export async function fetchPipelines(): Promise<GhlPipeline[]> {
  const loc = env.ghlLocationId()!;
  const body = await ghlGet(`${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(loc)}`);
  return (body.pipelines ?? []).map((p: any) => ({
    id:   p.id,
    name: p.name ?? null,
    stages: (p.stages ?? []).map((s: any, i: number) => ({
      id: s.id, name: s.name ?? null, position: typeof s.position === 'number' ? s.position : i,
    })),
    raw: p,
  }));
}

// ── Users (to resolve assignedTo → rep name) ──────────────────────────────────
export interface GhlUser { id: string; name: string | null; email: string | null }

export async function fetchUsers(): Promise<GhlUser[]> {
  const loc = env.ghlLocationId()!;
  try {
    const body = await ghlGet(`${GHL_BASE}/users/?locationId=${encodeURIComponent(loc)}`);
    return (body.users ?? []).map((u: any) => ({
      id:    u.id,
      name:  u.name ?? [u.firstName, u.lastName].filter(Boolean).join(' ') ?? null,
      email: u.email ?? null,
    }));
  } catch {
    // users.readonly scope may be absent on the token — non-fatal. Rep names
    // then fall back to whatever the opportunity / pipeline events already carry.
    return [];
  }
}

// ── Opportunities (paginated full pull) ───────────────────────────────────────
/** Returns the raw GHL opportunity objects across all pages. */
export async function fetchAllOpportunities(maxPages = 200): Promise<any[]> {
  const loc = env.ghlLocationId()!;
  const out: any[] = [];
  let url: string | null =
    `${GHL_BASE}/opportunities/search?location_id=${encodeURIComponent(loc)}&limit=100`;

  for (let i = 0; url && i < maxPages; i++) {
    const body = await ghlGet(url);
    const opps: any[] = body.opportunities ?? [];
    out.push(...opps);

    let next: string | null = body.meta?.nextPageUrl ?? null;
    if (next && !/^https?:\/\//i.test(next)) next = `${GHL_BASE}${next.startsWith('/') ? '' : '/'}${next}`;
    if (!next || opps.length === 0) break;
    url = next;
  }
  return out;
}
