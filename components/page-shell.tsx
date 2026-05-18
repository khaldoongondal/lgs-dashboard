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
    <div className="flex min-h-screen relative">
      <Sidebar current={current} />
      <div className="flex-1 min-w-0">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {showDatePicker && (
            <DateRangePicker preset={range.preset} from={range.from} to={range.to} />
          )}
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
