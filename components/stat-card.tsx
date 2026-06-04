import { IconArrowUpRight, IconArrowDownRight } from './icons';

interface Props {
  label:     string;
  value:     string;
  delta?:    number | null;     // -0.12 => -12%
  hint?:     string;
  accent?:   'default' | 'success' | 'warn' | 'danger';
}

export default function StatCard({ label, value, delta, hint, accent = 'default' }: Props) {
  const deltaPositive = (delta ?? 0) >= 0;

  const accentBar = {
    default: 'bg-slate-200',
    success: 'bg-brand-500',
    warn:    'bg-amber-400',
    danger:  'bg-rose-400',
  }[accent];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-card transition-shadow hover:shadow-soft">
      {/* left accent bar */}
      <span className={`absolute inset-y-0 left-0 w-1 ${accentBar}`} />

      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
        {delta !== undefined && delta !== null && (
          <span
            className={[
              'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold',
              deltaPositive ? 'bg-brand-50 text-brand-700' : 'bg-rose-50 text-rose-600',
            ].join(' ')}
          >
            {deltaPositive ? <IconArrowUpRight width={13} height={13} /> : <IconArrowDownRight width={13} height={13} />}
            {(Math.abs(delta) * 100).toFixed(1)}%
          </span>
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
