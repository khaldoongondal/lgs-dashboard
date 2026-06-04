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
      <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => go({ preset: p.value, from: null, to: null })}
            className={[
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              preset === p.value
                ? 'bg-white text-brand-700 shadow-card'
                : 'text-slate-500 hover:text-slate-900',
            ].join(' ')}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
        <IconCalendar className="text-slate-400" width={14} height={14} />
        <input
          type="date"
          value={from}
          onChange={(e) => go({ preset: 'custom', from: e.target.value, to })}
          className="bg-transparent text-xs text-slate-700 outline-none"
        />
        <span className="text-xs text-slate-400">→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => go({ preset: 'custom', from, to: e.target.value })}
          className="bg-transparent text-xs text-slate-700 outline-none"
        />
      </div>
    </div>
  );
}
