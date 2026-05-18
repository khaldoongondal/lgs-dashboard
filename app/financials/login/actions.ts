'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, sign } from '@/lib/auth/session';
import { env } from '@/lib/env';

export async function loginFinancials(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const nextRaw  = String(formData.get('next') ?? '/financials');
  const next     = nextRaw.startsWith('/financials') ? nextRaw : '/financials';

  let expected: string;
  let secret:   string;
  try {
    expected = env.financialsPassword();
    secret   = env.sessionSecret();
  } catch {
    redirect('/financials/login?error=not_configured');
  }

  if (password !== expected) {
    redirect('/financials/login?error=bad_password');
  }

  const token = await sign('financials', secret);
  cookies().set(COOKIE.financials, token, {
    httpOnly: true,
    secure:   env.isProd(),
    sameSite: 'lax',
    path:     '/',
    maxAge:   7 * 24 * 60 * 60,
  });

  redirect(next);
}
