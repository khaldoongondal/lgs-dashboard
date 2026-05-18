'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, sign } from '@/lib/auth/session';
import { env } from '@/lib/env';

export async function login(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const nextRaw  = String(formData.get('next') ?? '/dashboard');
  const next     = nextRaw.startsWith('/') ? nextRaw : '/dashboard';

  let expected: string;
  let secret:   string;
  try {
    expected = env.dashboardPassword();
    secret   = env.sessionSecret();
  } catch {
    redirect('/login?error=not_configured');
  }

  if (password !== expected) {
    redirect('/login?error=bad_password');
  }

  const token = await sign('dashboard', secret);
  cookies().set(COOKIE.dashboard, token, {
    httpOnly: true,
    secure:   env.isProd(),
    sameSite: 'lax',
    path:     '/',
    maxAge:   7 * 24 * 60 * 60,
  });

  redirect(next);
}
