'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import type { Preset } from '@/lib/date-range';
import { IconCalendar } from './icons';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today',     label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d',        label: '7 days' },
  { value: '30d',       label: '30 days' },
  { value: 'mtd',       label: 'MTD' },
  { value: 'qtd',       label: 'QTD' },
  { value: 'ytd',       label: 'YTD' },
];

export default function DateRangePicker({
  preset, from, to,
}: { preset: string; from: string; to: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function go(updates: Record<string, string | null>) {
    const u = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) u.delete(k);
      else u.set(k, v);
    }
    startTransition(() => router.push(`?${u.toString()}`));
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => go({ preset: p.value, from: null, to: null })}
            className={[
              'px-3 py-1.5 text-xs font-medium border-l first:border-l-0 border-slate-200',
              preset === p.value ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50',
            ].join(' ')}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
        <IconCalendar className="text-slate-400" width={14} height={14} />
        <input
          type="date"
          value={from}
          onChange={(e) => go({ preset: 'custom', from: e.target.value, to })}
          className="text-xs bg-transparent text-slate-700 outline-none"
        />
        <span className="text-slate-400 text-xs">→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => go({ preset: 'custom', from, to: e.target.value })}
          className="text-xs bg-transparent text-slate-700 outline-none"
        />
      </div>
    </div>
  );
}
