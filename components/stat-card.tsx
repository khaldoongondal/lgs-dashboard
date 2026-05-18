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
  const accentRing = {
    default: 'ring-slate-100',
    success: 'ring-emerald-100',
    warn:    'ring-amber-100',
    danger:  'ring-rose-100',
  }[accent];

  return (
    <div className={`card-pad ring-1 ${accentRing}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold text-slate-900 tabular-nums">{value}</div>
        {delta !== undefined && delta !== null && (
          <div
            className={[
              'flex items-center gap-0.5 text-xs font-medium',
              deltaPositive ? 'text-emerald-600' : 'text-rose-600',
            ].join(' ')}
          >
            {deltaPositive ? <IconArrowUpRight width={14} height={14} /> : <IconArrowDownRight width={14} height={14} />}
            {(Math.abs(delta) * 100).toFixed(1)}%
          </div>
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
