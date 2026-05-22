/**
 * Minimal GA4 Data API client. Service-account JWT auth done inline using Node
 * crypto — no `googleapis` dependency.
 *
 * Expects two env vars (both optional; functions throw with a clear message
 * if missing):
 *   GA4_PROPERTY_ID         — the numeric property ID (NOT the measurement ID)
 *   GA4_SERVICE_ACCOUNT_KEY — full contents of the service-account JSON key,
 *                              including private_key, client_email, private_key_id.
 *
 * The service account must be granted Viewer access to the GA4 property under
 * Admin → Property → Property Access Management.
 */

import crypto from 'node:crypto';

const TOKEN_ENDPOINT  = 'https://oauth2.googleapis.com/token';
const DATA_API_BASE   = 'https://analyticsdata.googleapis.com/v1beta';
const SCOPE           = 'https://www.googleapis.com/auth/analytics.readonly';
const ACCESS_TOKEN_TTL_MS = 55 * 60 * 1000;   // 55 min — Google issues 60-min tokens

interface ServiceAccountKey {
  client_email:    string;
  private_key:     string;
  private_key_id?: string;
}

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function parseKey(raw: string): ServiceAccountKey {
  let key: any;
  try { key = JSON.parse(raw); }
  catch (e) { throw new Error('GA4_SERVICE_ACCOUNT_KEY is not valid JSON'); }
  if (!key.client_email || !key.private_key) {
    throw new Error('GA4_SERVICE_ACCOUNT_KEY missing client_email or private_key');
  }
  return key as ServiceAccountKey;
}

/** Token cache so we don't sign a JWT every request. */
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getGa4AccessToken(serviceAccountKey: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const key = parseKey(serviceAccountKey);

  const now = Math.floor(Date.now() / 1000);
  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (key.private_key_id) header.kid = key.private_key_id;

  const claim = {
    iss:   key.client_email,
    scope: SCOPE,
    aud:   TOKEN_ENDPOINT,
    iat:   now,
    exp:   now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = base64url(signer.sign(key.private_key));
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`GA4 auth failed: ${body.error_description || body.error || res.statusText}`);
  }
  cachedToken = {
    token:     body.access_token as string,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
  };
  return body.access_token;
}

export interface Ga4PageDayRow {
  date:        string;        // YYYYMMDD from GA4 → reformatted to YYYY-MM-DD
  page_path:   string;
  users:       number;        // totalUsers
  page_views:  number;        // screenPageViews
  avg_seconds: number;        // averageSessionDuration
  bounce_rate: number;        // bounceRate (0..1)
}

export interface Ga4FetchOptions {
  propertyId:  string;
  accessToken: string;
  startDate:   string;        // YYYY-MM-DD or relative ("7daysAgo", "yesterday")
  endDate:     string;
}

export async function fetchGa4PageMetrics(opts: Ga4FetchOptions): Promise<Ga4PageDayRow[]> {
  const res = await fetch(
    `${DATA_API_BASE}/properties/${opts.propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: opts.startDate, endDate: opts.endDate }],
        dimensions: [{ name: 'date' }, { name: 'pagePath' }],
        metrics: [
          { name: 'totalUsers' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
        ],
        limit: 10000,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GA4 Data API failed: ${body.error?.message || res.statusText}`);
  }

  const out: Ga4PageDayRow[] = [];
  for (const row of body.rows ?? []) {
    const ymd  = row.dimensionValues?.[0]?.value ?? '';      // e.g. "20260520"
    const path = row.dimensionValues?.[1]?.value ?? '/';
    const isoDate = ymd.length === 8
      ? `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`
      : ymd;
    out.push({
      date:        isoDate,
      page_path:   path,
      users:       Number(row.metricValues?.[0]?.value ?? 0),
      page_views:  Number(row.metricValues?.[1]?.value ?? 0),
      avg_seconds: Number(row.metricValues?.[2]?.value ?? 0),
      bounce_rate: Number(row.metricValues?.[3]?.value ?? 0),
    });
  }
  return out;
}

/**
 * Map a URL path to one of the 4 funnel slugs. Same logic as pixel.js — kept
 * in sync intentionally. Anything that doesn't match falls into "other".
 */
export function pathToSlug(path: string): 'vsl' | 'optin' | 'booking' | 'thankyou' | 'other' {
  const p = (path || '').toLowerCase();
  if (/(thank|confirm|booked|success)/.test(p))   return 'thankyou';
  if (/(book|calendar|schedule)/.test(p))         return 'booking';
  if (/(optin|opt-in|signup|sign-up|form)/.test(p)) return 'optin';
  if (/(lp|vsl|landing|home)/.test(p))            return 'vsl';
  if (p === '/' || p === '')                      return 'vsl';
  return 'other';
}
