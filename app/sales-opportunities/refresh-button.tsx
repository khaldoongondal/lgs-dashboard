'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { refreshOpportunities, type RefreshState } from './actions';

const INITIAL: RefreshState = { ok: null, message: '' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-60"
    >
      {pending ? 'Syncing…' : '↻ Refresh from GHL'}
    </button>
  );
}

export default function RefreshButton() {
  const [state, formAction] = useFormState(refreshOpportunities, INITIAL);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <SubmitButton />
      {state.ok === true  && <span className="text-xs text-emerald-600">{state.message}</span>}
      {state.ok === false && <span className="text-xs text-red-600">{state.message}</span>}
    </form>
  );
}
