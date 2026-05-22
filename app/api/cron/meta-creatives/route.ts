/**
 * GET /api/cron/meta-creatives — fetch + cache creative URLs for every ad
 * in the account. Idempotent. Run manually (not in vercel.json — Hobby plan
 * is at the 2-cron cap already).
 *
 * Auth: CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const GRAPH = 'https://graph.facebook.com/v21.0';

function authOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const fromQuery  = url.searchParams.get('secret');
  const fromHeader = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return fromQuery === secret || fromHeader === secret;
}

export async function GET(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const token   = env.metaAccessToken();
  const account = env.metaAdAccountId();
  if (!token || !account) {
    return NextResponse.json({ error: 'meta_not_configured' }, { status: 503 });
  }

  // Pull all ads with light creative info. `object_story_spec` and other
  // nested expansions blow past Meta's per-request size cap on busy accounts,
  // so we keep this list lean.
  const fields = [
    'id', 'name', 'campaign_id', 'adset_id',
    'creative{thumbnail_url,image_url,video_id,title,body,call_to_action_type}',
    'preview_shareable_link',
  ].join(',');

  let next: string | null = `${GRAPH}/${account}/ads?fields=${fields}&limit=50&access_token=${encodeURIComponent(token)}`;

  type Row = {
    ad_id:         string;
    ad_name:       string | null;
    campaign_id:   string | null;
    adset_id:      string | null;
    thumbnail_url: string | null;
    image_url:     string | null;
    video_id:      string | null;
    title:         string | null;
    body:          string | null;
    cta_type:      string | null;
    permalink_url: string | null;
    raw_payload:   unknown;
    fetched_at:    string;
  };

  const rows: Row[] = [];

  while (next) {
    try {
      const res = await fetch(next, { signal: AbortSignal.timeout(20_000) });
      const body: any = await res.json();
      if (!res.ok) {
        return NextResponse.json(
          { error: 'meta_api', detail: body?.error?.message || `HTTP ${res.status}` },
          { status: 502 },
        );
      }
      for (const ad of body.data || []) {
        const c = ad.creative || {};
        rows.push({
          ad_id:         ad.id,
          ad_name:       ad.name ?? null,
          campaign_id:   ad.campaign_id ?? null,
          adset_id:      ad.adset_id ?? null,
          thumbnail_url: c.thumbnail_url ?? null,
          image_url:     c.image_url     ?? null,
          video_id:      c.video_id      ?? null,
          title:         c.title         ?? null,
          body:          c.body          ?? null,
          cta_type:      c.call_to_action_type ?? null,
          permalink_url: ad.preview_shareable_link ?? null,
          raw_payload:   ad,
          fetched_at:    new Date().toISOString(),
        });
      }
      next = body.paging?.next ?? null;
    } catch (err) {
      return NextResponse.json(
        { error: 'fetch_failed', detail: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  }

  if (rows.length === 0) return NextResponse.json({ ok: true, ads: 0 });

  const sb = serviceClient();
  const { error } = await sb.from('ad_creatives').upsert(rows, { onConflict: 'ad_id' });
  if (error) {
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ads: rows.length });
}
