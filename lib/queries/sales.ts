/**
 * Sales-pipeline rollups per rep in a date range.
 * Source: public.sales_metrics. Rates derived at query time.
 */

import { maybeServiceClient } from '@/lib/supabase/server';

export interface RepRow {
  rep_id:           string;
  rep_name:         string;
  intro_calls:      number;
  live_intros:      number;
  offers_made:      number;
  closes:           number;
  collected:        number;
  show_rate:        number | null;
  offer_rate:       number | null;
  close_rate:       number | null;
  call_to_close:    number | null;
  collected_per_call: number | null;
}

export interface SalesSummary {
  rows:  RepRow[];
  total: RepRow;
  avg:   RepRow;
}

function withRates(r: Omit<RepRow, 'show_rate'|'offer_rate'|'close_rate'|'call_to_close'|'collected_per_call'>): RepRow {
  return {
    ...r,
    show_rate:          r.intro_calls > 0 ? r.live_intros / r.intro_calls : null,
    offer_rate:         r.live_intros > 0 ? r.offers_made / r.live_intros : null,
    close_rate:         r.offers_made > 0 ? r.closes / r.offers_made : null,
    call_to_close:      r.intro_calls > 0 ? r.closes / r.intro_calls : null,
    collected_per_call: r.intro_calls > 0 ? r.collected / r.intro_calls : null,
  };
}

export async function loadSalesSummary(fromISO: string, toISO: string): Promise<SalesSummary> {
  const sb = maybeServiceClient();
  if (!sb) return emptySummary();

  const { data, error } = await sb
    .from('sales_metrics')
    .select('*')
    .gte('date', fromISO)
    .lte('date', toISO);

  if (error) {
    console.warn('[sales] supabase error:', error.message);
    return emptySummary();
  }

  // Group by rep
  const byRep = new Map<string, RepRow>();
  for (const r of data ?? []) {
    const rr = r as any;
    const key = rr.rep_id ?? '(unassigned)';
    let existing = byRep.get(key);
    if (!existing) {
      existing = withRates({
        rep_id:      key,
        rep_name:    rr.rep_name || key,
        intro_calls: 0,
        live_intros: 0,
        offers_made: 0,
        closes:      0,
        collected:   0,
      });
    }
    existing.intro_calls += Number(rr.intro_calls) || 0;
    existing.live_intros += Number(rr.live_intros) || 0;
    existing.offers_made += Number(rr.offers_made) || 0;
    existing.closes      += Number(rr.closes)      || 0;
    existing.collected   += Number(rr.collected)   || 0;
    byRep.set(key, existing);
  }

  // Recompute rates after summation
  const rows = Array.from(byRep.values())
    .map((r) => withRates(r))
    .sort((a, b) => b.collected - a.collected);

  // Team total
  const sum: any = rows.reduce(
    (acc, r) => ({
      intro_calls: acc.intro_calls + r.intro_calls,
      live_intros: acc.live_intros + r.live_intros,
      offers_made: acc.offers_made + r.offers_made,
      closes:      acc.closes      + r.closes,
      collected:   acc.collected   + r.collected,
    }),
    { intro_calls: 0, live_intros: 0, offers_made: 0, closes: 0, collected: 0 }
  );

  const total = withRates({ rep_id: '__total', rep_name: 'Team Total', ...sum });
  const n = Math.max(rows.length, 1);
  const avg = withRates({
    rep_id: '__avg',
    rep_name: 'Team Avg / Rep',
    intro_calls: sum.intro_calls / n,
    live_intros: sum.live_intros / n,
    offers_made: sum.offers_made / n,
    closes:      sum.closes      / n,
    collected:   sum.collected   / n,
  });

  return { rows, total, avg };
}

function emptySummary(): SalesSummary {
  const zero = withRates({
    rep_id: '', rep_name: '',
    intro_calls: 0, live_intros: 0, offers_made: 0, closes: 0, collected: 0,
  });
  return { rows: [], total: { ...zero, rep_id: '__total', rep_name: 'Team Total' },
                       avg:   { ...zero, rep_id: '__avg',   rep_name: 'Team Avg / Rep' } };
}
