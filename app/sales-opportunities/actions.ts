'use server';

import { revalidatePath } from 'next/cache';
import { syncOpportunities } from '@/lib/ghl-sync';

export interface RefreshState { ok: boolean | null; message: string }

/** Server action: pull live from GHL, refresh the page data, report the result. */
export async function refreshOpportunities(_prev: RefreshState, _formData: FormData): Promise<RefreshState> {
  const res = await syncOpportunities();
  revalidatePath('/sales-opportunities');
  if (res.ok) {
    return { ok: true, message: `Synced ${res.opportunities} opportunities · ${res.pipelines} pipelines.` };
  }
  return { ok: false, message: res.error || 'Sync failed.' };
}
