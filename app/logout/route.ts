import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope'); // 'financials' to clear only that
  const jar = cookies();
  if (scope === 'financials') {
    jar.delete(COOKIE.financials);
  } else {
    jar.delete(COOKIE.dashboard);
    jar.delete(COOKIE.financials);
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

export async function GET(req: Request) {
  return POST(req);
}
