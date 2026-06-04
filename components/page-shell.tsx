import Sidebar from './sidebar';
import DateRangePicker from './date-range-picker';
import type { DateRange } from '@/lib/date-range';

interface Props {
  current: string;
  title:   string;
  subtitle?: string;
  range:   DateRange;
  showDatePicker?: boolean;
  children: React.ReactNode;
}

export default async function PageShell({
  current, title, subtitle, range, showDatePicker = true, children,
}: Props) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar current={current} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur-md">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          {showDatePicker && (
            <DateRangePicker preset={range.preset} from={range.from} to={range.to} />
          )}
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
