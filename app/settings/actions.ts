'use server';

import { revalidatePath } from 'next/cache';
import { serviceClient } from '@/lib/supabase/server';

/**
 * Update one expense_config row by id. Accepts a string (so we can keep the
 * form's `defaultValue={...}` simple) and figures out whether to set
 * value_numeric or value_pct based on which one was non-null before.
 *
 * Percent fields are entered as percentages (e.g. "12.5") and stored as
 * fractions (0.125) — the input UI labels them with a "%" suffix so the
 * user knows.
 */
export async function updateExpenseConfig(formData: FormData): Promise<void> {
  const id  = Number(formData.get('id'));
  const raw = String(formData.get('value') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');   // 'numeric' | 'pct'

  if (!Number.isFinite(id)) return;
  if (raw === '') return;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return;

  const sb = serviceClient();
  const update: Record<string, number | null> = {
    value_numeric: null,
    value_pct:     null,
  };
  if (kind === 'pct') {
    // Entered as 12.5 → stored as 0.125. Allow 0.x input too (rare).
    update.value_pct = parsed > 1 ? parsed / 100 : parsed;
  } else {
    update.value_numeric = parsed;
  }

  await sb.from('expense_config').update(update).eq('id', id);
  revalidatePath('/settings');
  revalidatePath('/sales');     // commissions live there
  revalidatePath('/financials');
}
