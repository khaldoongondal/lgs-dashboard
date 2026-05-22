'use server';

import { revalidatePath } from 'next/cache';
import { serviceClient } from '@/lib/supabase/server';

const ALLOWED_STATUSES = new Set([
  '', 'new', 'contacted', 'qualified', 'unqualified', 'nurturing', 'closed_won', 'closed_lost',
]);

export async function updateLead(formData: FormData): Promise<void> {
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id <= 0) return;

  const notes = String(formData.get('notes') ?? '').slice(0, 5000);
  const lead_status_raw = String(formData.get('lead_status') ?? '').trim();
  const lead_status = ALLOWED_STATUSES.has(lead_status_raw) ? (lead_status_raw || null) : null;

  const sb = serviceClient();
  await sb.from('ghl_contacts').update({
    notes:       notes || null,
    lead_status,
    updated_at:  new Date().toISOString(),
  }).eq('id', id);

  revalidatePath(`/leads/${id}`);
  revalidatePath('/leads');
}
