/**
 * CORS for the public ingest endpoints (/api/events, /api/events/heartbeat).
 *
 * The pixel runs on the client's funnel domain (e.g. leadder.io) and posts
 * cross-origin via navigator.sendBeacon, which ALWAYS sends the request in
 * credentials='include' mode. The CORS spec forbids replying with the wildcard
 * 'Access-Control-Allow-Origin: *' to a credentialed request — the server must
 * echo the caller's Origin and set Allow-Credentials: true.
 *
 * These endpoints carry no auth cookies and are public by design, so reflecting
 * whatever Origin calls us is safe. (The '*' fallback only triggers for
 * non-browser callers that send no Origin header, where these headers are
 * ignored anyway.)
 */
import { NextResponse } from 'next/server';

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  return {
    'Access-Control-Allow-Origin':      origin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods':     'POST, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type',
    'Access-Control-Max-Age':           '600',
    // Caches must key on Origin since the allowed origin is dynamic.
    'Vary':                             'Origin',
  };
}

/** 204 response for an OPTIONS preflight, with the reflected-origin CORS headers. */
export function corsPreflight(req: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

/** Attach CORS headers to an existing response and return it. */
export function withCors(req: Request, res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}
