/**
 * Clients queries — drives /clients. Joins the clients table with ghl_contacts
 * so we can surface email/phone alongside the billing data.
 *
 * LTV is computed inline: mrr_value × tenure_months (active clients use
 * months-since-started; churned clients use the generated tenure_months
 * column from the schema).
 */

import { maybeServiceClient } from '@/lib/supabase/server';

export type ClientStatus = 'active' | 'at_risk' | 'churned' | 'paused';

export interface ClientRow {
  id:                   number;
  ghl_contact_id:       string;
  contact_id:           number | null;
  email:                string | null;
  first_name:           string | null;
  last_name:            string | null;
  phone:                string | null;
  status:               ClientStatus;
  started_at:           string;
  churned_at:           string | null;
  tenure_months:        number | null;
  mrr_value:            number;
  ltv:                  number | null;
  last_payment_date:    string | null;
  attributed_campaign:  string | null;
  attributed_ad:        string | null;
  attributed_source:    string | null;
  rep_name:             string | null;
  churn_reason:         string | null;
}

export interface ClientsSummary {
  rows:        ClientRow[];
  by_status:   Record<ClientStatus, number>;
  total_mrr:   number;
  total_ltv:   number;
  avg_tenure:  number | null;
}

export async function loadClients(opts: { status?: ClientStatus | 'all' } = {}): Promise<ClientsSummary> {
  const sb = maybeServiceClient();
  if (!sb) return emptySummary();

  let query = sb.from('clients').select('*').order('started_at', { ascending: false }).limit(500);
  if (opts.status && opts.status !== 'all') query = query.eq('status', opts.status);

  const { data: clients, error } = await query;
  if (error || !clients) return emptySummary();

  // Hydrate names/emails from ghl_contacts.
  const contactIds = clients.map((c: any) => c.contact_id).filter((v): v is number => v != null);
  let contactMap = new Map<number, { email: string | null; first_name: string | null; last_name: string | null; phone: string | null }>();
  if (contactIds.length > 0) {
    const { data: contacts } = await sb
      .from('ghl_contacts')
      .select('id, email, first_name, last_name, phone')
      .in('id', contactIds);
    for (const c of contacts ?? []) {
      const cc = c as any;
      contactMap.set(cc.id, { email: cc.email, first_name: cc.first_name, last_name: cc.last_name, phone: cc.phone });
    }
  }

  const now = Date.now();

  const rows: ClientRow[] = clients.map((c: any) => {
    const con = c.contact_id ? contactMap.get(c.contact_id) : null;
    // For active clients tenure_months from the DB is null; compute on the fly.
    let tenure: number | null = c.tenure_months != null ? Number(c.tenure_months) : null;
    if (tenure === null && c.started_at) {
      const start = new Date(c.started_at).getTime();
      tenure = (now - start) / (1000 * 60 * 60 * 24 * 30.4375);
    }
    const mrr = Number(c.mrr_value) || 0;
    const ltv = tenure !== null ? tenure * mrr : null;

    return {
      id:                  c.id,
      ghl_contact_id:      c.ghl_contact_id,
      contact_id:          c.contact_id ?? null,
      email:               con?.email      ?? null,
      first_name:          con?.first_name ?? null,
      last_name:           con?.last_name  ?? null,
      phone:               con?.phone      ?? null,
      status:              c.status as ClientStatus,
      started_at:          c.started_at,
      churned_at:          c.churned_at,
      tenure_months:       tenure,
      mrr_value:           mrr,
      ltv,
      last_payment_date:   c.last_payment_date,
      attributed_campaign: c.attributed_campaign,
      attributed_ad:       c.attributed_ad,
      attributed_source:   c.attributed_source,
      rep_name:            c.rep_name,
      churn_reason:        c.churn_reason,
    };
  });

  const by_status: Record<ClientStatus, number> = { active: 0, at_risk: 0, churned: 0, paused: 0 };
  let total_mrr = 0;
  let total_ltv = 0;
  let tenure_sum = 0;
  let tenure_n   = 0;
  for (const r of rows) {
    by_status[r.status] = (by_status[r.status] ?? 0) + 1;
    if (r.status === 'active') total_mrr += r.mrr_value;
    if (r.ltv !== null) total_ltv += r.ltv;
    if (r.tenure_months !== null) { tenure_sum += r.tenure_months; tenure_n++; }
  }
  const avg_tenure = tenure_n > 0 ? tenure_sum / tenure_n : null;

  return { rows, by_status, total_mrr, total_ltv, avg_tenure };
}

function emptySummary(): ClientsSummary {
  return {
    rows: [],
    by_status: { active: 0, at_risk: 0, churned: 0, paused: 0 },
    total_mrr: 0, total_ltv: 0, avg_tenure: null,
  };
}
