import { loginFinancials } from './actions';

export const dynamic = 'force-dynamic';

export default function FinancialsLoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const error = searchParams.error === 'bad_password' ? 'Incorrect password.' : null;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card-pad w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-xs uppercase tracking-widest text-slate-500">LGS · Financials</div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Restricted area</h1>
          <p className="mt-1 text-sm text-slate-500">Second password required.</p>
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
