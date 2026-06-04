import { loginFinancials } from './actions';
import Logo from '@/components/logo';
import { IconLock } from '@/components/icons';

export const dynamic = 'force-dynamic';

export default function FinancialsLoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const error = searchParams.error === 'bad_password' ? 'Incorrect password.' : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-brand-50 via-white to-white" />
      <div className="pointer-events-none absolute left-1/2 top-[-15%] -z-10 h-[420px] w-[680px] -translate-x-1/2 rounded-full bg-brand-200/40 blur-3xl" />

      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-soft">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo />
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            <IconLock width={13} height={13} />
            Restricted area
          </div>
          <p className="mt-2 text-sm text-slate-500">Second password required.</p>
        </div>

        <form action={loginFinancials} className="space-y-4">
          <input type="hidden" name="next" value={searchParams.next ?? '/financials'} />
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
          <button type="submit" className="btn-primary w-full">Unlock</button>
        </form>
      </div>
    </main>
  );
}
