import { login } from './actions';
import Logo from '@/components/logo';

export const dynamic = 'force-dynamic';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const error =
    searchParams.error === 'bad_password'
      ? 'Incorrect password.'
      : searchParams.error === 'not_configured'
        ? 'Server not configured — set SESSION_SECRET and DASHBOARD_PASSWORD.'
        : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* soft green backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-brand-50 via-white to-white" />
      <div className="pointer-events-none absolute left-1/2 top-[-15%] -z-10 h-[420px] w-[680px] -translate-x-1/2 rounded-full bg-brand-200/40 blur-3xl" />

      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-soft">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo />
          <p className="mt-4 text-sm text-slate-500">Sign in to your growth dashboard</p>
        </div>

        <form action={login} className="space-y-4">
          <input type="hidden" name="next" value={searchParams.next ?? '/dashboard'} />
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              required
              className="input"
            />
          </div>
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-100">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary w-full">Sign in</button>
        </form>
      </div>
    </main>
  );
}
