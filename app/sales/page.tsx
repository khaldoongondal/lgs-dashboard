import PageShell from '@/components/page-shell';
import SalesPerformance from './sales-performance';
import { loadSalesYear } from '@/lib/queries/sales';
import type { DateRange } from '@/lib/date-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SP { period?: string }   // period=YYYY-MM — year drives the page, month drives the KPI cards

function parsePeriod(period: string | undefined): { year: number; month: number } {
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();           // 0–11

  const m = /^(\d{4})-(\d{1,2})$/.exec(period ?? '');
  if (m) {
    year = Number(m[1]);
    const mm = Number(m[2]) - 1;
    if (mm >= 0 && mm <= 11) month = mm;
  }
  return { year, month };
}

export default async function SalesPage({ searchParams }: { searchParams: SP }) {
  const { year, month } = parsePeriod(searchParams.period);
  const { reps, cells, tiers } = await loadSalesYear(year);

  // PageShell needs a DateRange for its (hidden) date picker; the year span is fine.
  const range: DateRange = { preset: 'custom', from: `${year}-01-01`, to: `${year}-12-31` };

  return (
    <PageShell
      current="/sales"
      title="Sales Performance"
      subtitle="One-call close · rep filter, monthly KPIs, full-year trends"
      range={range}
      showDatePicker={false}
    >
      <SalesPerformance
        year={year}
        defaultMonth={month}
        reps={reps}
        cells={cells}
        tiers={tiers}
      />
    </PageShell>
  );
}
