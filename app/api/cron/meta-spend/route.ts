/**
 * GET /api/cron/meta-spend — pulls ad-level insights from Meta on a 6h cadence.
 *
 * Auth:
 *   - Vercel cron: includes `Authorization: Bearer ${CRON_SECRET}` automatically
 *     when the cron is configured in vercel.json AND CRON_SECRET env var is set.
 *   - Manual trigger: pass `?secret=<CRON_SECRET>` or the same Bearer header.
 *
 * Query params:
 *   - date         single ISO date (defaults to yesterday in UTC)
 *   - since,until  alternative range; pulls inclusive day-by-day
 *
 * Upserts into meta_ad_performance keyed on (date, ad_id). Idempotent.
 *
 * Spec: alongside spend/impressions/clicks, we also pull Meta's reported
 * conversion counts (actions) and video engagement metrics (video_p3_watched,
 * video_play) — these power the "Meta-reported" columns on the dashboard
 * shown side-by-side with our calculated numbers.
 */
import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const GRAPH = 'https://graph.facebook.com/v21.0';

interface ActionRow { action_type: string; value: string }

interface InsightRow {
  date_start:                  string;
  date_stop:                   string;
  account_id:                  string;
  campaign_id:                 string;
  campaign_name?:              string;
  adset_id:                    string;
  adset_name?:                 string;
  ad_id:                       string;
  ad_name?:                    string;
  spend?:                      string;
  impressions?:                string;
  clicks?:                     string;
  reach?:                      string;
  frequency?:                  string;
  ctr?:                        string;
  cpc?:                        string;
  cpm?:                        string;
  cost_per_unique_click?:      string;
  unique_inline_link_clicks?:  string;
  unique_outbound_clicks_ctr?: string;
  cost_per_result?:            { value: string }[] | string;
  actions?:                    ActionRow[];
  video_play_actions?:         ActionRow[];
}

interface AdStatus {
  effective_status?:           string;
  configured_status?:          string;
  campaign_effective_status?:  string;
  adset_effective_status?:     string;
}

async function fetchAdStatuses(account: string, token: string): Promise<Map<string, AdStatus>> {
  const map = new Map<string, AdStatus>();
  const fields = 'id,effective_status,configured_status,campaign{effective_status},adset{effective_status}';
  let next: string | null =
    `${GRAPH}/${account}/ads?fields=${fields}&limit=200&access_token=${encodeURIComponent(token)}`;

  while (next) {
    try {
      const res = await fetch(next, { signal: AbortSignal.timeout(15_000) });
      const body: any = await res.json();
      if (!res.ok) break;
      for (const ad of body.data || []) {
        map.set(ad.id, {
          effective_status:           ad.effective_status,
          configured_status:          ad.configured_status,
          campaign_effective_status:  ad.campaign?.effective_status,
          adset_effective_status:     ad.adset?.effective_status,
        });
      }
      next = body.paging?.next ?? null;
    } catch {
      break;
    }
  }
  return map;
}

function sumActions(rows: ActionRow[] | undefined): number {
  if (!rows || rows.length === 0) return 0;
  return rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
}

/**
 * Pull Meta's reported lead count from the `actions` array.
 * Meta has several lead-flavoured action_types depending on the campaign
 * objective and pixel setup; "lead" is the canonical one we count.
 */
function metaLeads(actions: ActionRow[] | undefined): number {
  if (!actions) return 0;
  return actions
    .filter((a) => a.action_type === 'lead')
    .reduce((s, a) => s + (Number(a.value) || 0), 0);
}

function metaPurchases(actions: ActionRow[] | undefined): number {
  if (!actions) return 0;
  return actions
    .filter((a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase')
    .reduce((s, a) => s + (Number(a.value) || 0), 0);
}

/**
 * Meta's "3-second video view" surfaces as action_type=video_view in the
 * actions array, not as a dedicated insights field. The video_p3_watched_actions
 * field name is folklore — it doesn't exist in Meta's Marketing API.
 */
function video3SecViews(actions: ActionRow[] | undefined): number {
  if (!actions) return 0;
  return actions
    .filter((a) => a.action_type === 'video_view')
    .reduce((s, a) => s + (Number(a.value) || 0), 0);
}

/** Meta returns cost_per_result as `[{ value: "12.34", ... }]` or omits it entirely. */
function firstCostPerResult(raw: InsightRow['cost_per_result']): number | null {
  if (!raw) return null;
  if (typeof raw === 'string') return Number(raw) || null;
  if (Array.isArray(raw) && raw.length > 0) return Number(raw[0].value) || null;
  return null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function* eachDayInclusive(since: string, until: string): Generator<string> {
  const s = new Date(`${since}T00:00:00Z`);
  const u = new Date(`${until}T00:00:00Z`);
  for (let t = s.getTime(); t <= u.getTime(); t += 86_400_000) {
    yield ymd(new Date(t));
  }
}

function authOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev mode — no secret set means accept all
  const url = new URL(req.url);
  const fromQuery  = url.searchParams.get('secret');
  const fromHeader = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return fromQuery === secret || fromHeader === secret;
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token   = env.metaAccessToken();
  const account = env.metaAdAccountId();
  if (!token || !account) {
    return NextResponse.json({ error: 'meta_not_configured' }, { status: 503 });
  }

  const url = new URL(req.url);
  const dateParam  = url.searchParams.get('date');
  const sinceParam = url.searchParams.get('since');
  const untilParam = url.searchParams.get('until');

  let dates: string[];
  if (sinceParam && untilParam) {
    dates = Array.from(eachDayInclusive(sinceParam, untilParam));
  } else if (dateParam) {
    dates = [dateParam];
  } else {
    const yesterday = new Date(Date.now() - 86_400_000);
    dates = [ymd(yesterday)];
  }

  if (dates.length > 60) {
    return NextResponse.json({ error: 'range_too_large', max_days: 60 }, { status: 400 });
  }

  const sb = serviceClient();
  const summary: Array<{ date: string; rows: number; spend: number; error?: string }> = [];

  // Fetch ad statuses ONCE per cron run — same map applies to all dates.
  const statusMap = await fetchAdStatuses(account, token);

  for (const date of dates) {
    const fields = [
      'account_id', 'campaign_id', 'campaign_name',
      'adset_id', 'adset_name',
      'ad_id', 'ad_name',
      'spend', 'impressions', 'clicks', 'reach', 'frequency',
      'ctr', 'cpc', 'cpm',
      'cost_per_unique_click', 'unique_inline_link_clicks', 'unique_outbound_clicks_ctr',
      'cost_per_result',
      'actions',
      'video_play_actions',
    ].join(',');

    const params = new URLSearchParams({
      level: 'ad',
      time_range: JSON.stringify({ since: date, until: date }),
      fields,
      limit: '500',
      access_token: token,
    });

    let allRows: InsightRow[] = [];
    let next: string | null = `${GRAPH}/${account}/insights?${params.toString()}`;
    let fetchError: string | null = null;

    try {
      while (next) {
        const res = await fetch(next, { signal: AbortSignal.timeout(20_000) });
        const body: any = await res.json();
        if (!res.ok) {
          fetchError = body?.error?.message || `HTTP ${res.status}`;
          next = null;
          break;
        }
        allRows = allRows.concat(body.data || []);
        next = body.paging?.next ?? null;
      }
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
    }

    if (fetchError) {
      summary.push({ date, rows: 0, spend: 0, error: fetchError });
      continue;
    }
    if (allRows.length === 0) {
      summary.push({ date, rows: 0, spend: 0 });
      continue;
    }

    const upsertRows = allRows.map((r) => {
      const status = statusMap.get(r.ad_id);
      return {
        date,
        account_id:    r.account_id || account.replace(/^act_/, ''),
        campaign_id:   r.campaign_id,
        campaign_name: r.campaign_name ?? null,
        adset_id:      r.adset_id,
        adset_name:    r.adset_name ?? null,
        ad_id:         r.ad_id,
        ad_name:       r.ad_name ?? null,
        spend:         Number(r.spend ?? 0),
        impressions:   Number(r.impressions ?? 0),
        clicks:        Number(r.clicks ?? 0),
        reach:         Number(r.reach ?? 0),
        frequency:     r.frequency ? Number(r.frequency) : null,
        ctr:           r.ctr       ? Number(r.ctr)       : null,
        cpc:           r.cpc       ? Number(r.cpc)       : null,
        cpm:           r.cpm       ? Number(r.cpm)       : null,
        // New Meta-reported metric columns
        cost_per_result:            firstCostPerResult(r.cost_per_result),
        cost_per_unique_click:      r.cost_per_unique_click ? Number(r.cost_per_unique_click) : null,
        unique_link_clicks:         r.unique_inline_link_clicks ? Number(r.unique_inline_link_clicks) : null,
        unique_outbound_clicks_ctr: r.unique_outbound_clicks_ctr ? Number(r.unique_outbound_clicks_ctr) : null,
        video_p3_watched:           video3SecViews(r.actions),
        video_play_actions:         sumActions(r.video_play_actions),
        actions:                    r.actions ?? null,
        meta_leads:                 metaLeads(r.actions),
        meta_purchases:             metaPurchases(r.actions),
        // Promote effective_status from raw_payload into a queryable column
        effective_status:           status?.effective_status ?? null,
        // Keep raw_payload for diagnostics — every API field is preserved
        raw_payload:                { ...r, ...(status ?? {}) },
        synced_at:                  new Date().toISOString(),
      };
    });

    const totalSpend = upsertRows.reduce((s, r) => s + r.spend, 0);

    const { error } = await sb
      .from('meta_ad_performance')
      .upsert(upsertRows, { onConflict: 'date,ad_id' });

    if (error) {
      summary.push({ date, rows: 0, spend: 0, error: error.message });
    } else {
      summary.push({ date, rows: upsertRows.length, spend: totalSpend });
    }
  }

  const totalRows  = summary.reduce((s, r) => s + r.rows,  0);
  const totalSpend = summary.reduce((s, r) => s + r.spend, 0);
  const errors     = summary.filter((s) => s.error);

  return NextResponse.json({
    ok:           errors.length === 0,
    total_rows:   totalRows,
    total_spend:  Number(totalSpend.toFixed(2)),
    days_synced:  dates.length,
    errors:       errors.length ? errors : undefined,
    per_day:      summary,
  });
}
