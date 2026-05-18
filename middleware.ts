/**
 * Edge middleware: two-tier auth gate.
 *
 *  /login                  → public
 *  /financials/login       → public (still requires lgs_auth though)
 *  /api/events             → public (browser pixel)
 *  /api/webhooks/*         → public (HMAC verified inside the handler)
 *  /api/health             → public
 *
 *  Everything else         → requires lgs_auth
 *  /financials and /api below it → also requires lgs_financials_auth
 *
 * Cookies are HMAC-signed with SESSION_SECRET (see lib/auth/session.ts).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, verify } from '@/lib/auth/session';

const PUBLIC_PREFIXES = [
  '/login',
  '/api/events',
  '/api/webhooks',
  '/api/health',
  '/pixel.js',
  '/favicon',
  '/_next',
  '/public',
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Special case: /financials/login itself needs lgs_auth but not lgs_financials_auth
  const isFinancialsLogin = pathname === '/financials/login' || pathname.startsWith('/financials/login/');

  if (isPublic(pathname) && !pathname.startsWith('/financials')) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // No secret configured: redirect everything to login so the operator notices.
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('error', 'not_configured');
    return NextResponse.redirect(url);
  }

  // Tier 1
  const dashCookie = req.cookies.get(COOKIE.dashboard)?.value;
  const dashOk = await verify(dashCookie, 'dashboard', secret);
  if (!dashOk) {
    if (pathname.startsWith('/api/')) {
      return new NextResponse(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Tier 2 for /financials/** (except the login page)
  const needsFinancials = pathname === '/financials' || pathname.startsWith('/financials/');
  if (needsFinancials && !isFinancialsLogin) {
    const finCookie = req.cookies.get(COOKIE.financials)?.value;
    const finOk = await verify(finCookie, 'financials', secret);
    if (!finOk) {
      const url = req.nextUrl.clone();
      url.pathname = '/financials/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except static files. We re-permit publics inside.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
