import { login } from './actions';

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
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card-pad w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-xs uppercase tracking-widest text-slate-500">LGS</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Growth Dashboard</h1>
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
