'use client';

import { useMemo, useState } from 'react';
import StatCard from '@/components/stat-card';
import ExportButton from '@/components/export-button';
import LineChart, { type Series } from '@/components/line-chart';
import { fmtCurrency, fmtNumber, fmtPct } from '@/lib/format';
import {
  addRaw, deriveRates, emptyRaw, scaleRaw, tieredCommission,
  RATE_BENCHMARKS, MONTH_LABELS, MONTH_ABBR, QUARTERS,
  type RawMetrics, type DerivedRates, type TierRates, type RepMonthCell, type RateKey,
} from '@/lib/sales-calc';

interface Props {
  year:         number;
  defaultMonth: number;             // 0–11 — drives the KPI cards
  reps:         { rep_id: string; rep_name: string }[];
  cells:        RepMonthCell[];
  tiers:        TierRates;
}

type RowKind = 'month' | 'quarter' | 'total' | 'avg';
interface Row {
  key:        string;
  label:      string;
  kind:       RowKind;
  raw:        RawMetrics;
  d:          DerivedRates;
  commission: number;
  monthIndex?: number;
}

type ColType = 'int' | 'money' | 'pct';
interface Col {
  key:   string;
  label: string;
  type:  ColType;
  get:   (r: Row) => number | null;
  bench?: RateKey;
}

interface Group { label: string; cols: Col[] }

const GROUPS: Group[] = [
  {
    label: 'Volume',
    cols: [
      { key: 'intro_calls', label: 'Intro Calls', type: 'int', get: (r) => r.raw.intro_calls },
      { key: 'live_intros', label: 'Live Intros', type: 'int', get: (r) => r.raw.live_intros },
      { key: 'offers_made', label: 'Offers',      type: 'int', get: (r) => r.raw.offers_made },
      { key: 'deposits',    label: 'Deposits',    type: 'int', get: (r) => r.raw.deposits },
      { key: 'closes',      label: 'Closes',      type: 'int', get: (r) => r.raw.closes },
    ],
  },
  {
    label: 'Rates',
    cols: [
      { key: 'show_rate',         label: 'Show %',        type: 'pct', bench: 'show_rate',         get: (r) => r.d.show_rate },
      { key: 'offer_rate',        label: 'Offer %',       type: 'pct', bench: 'offer_rate',        get: (r) => r.d.offer_rate },
      { key: 'offer_commit_rate', label: 'Offer Cmt %',   type: 'pct', bench: 'offer_commit_rate', get: (r) => r.d.offer_commit_rate },
      { key: 'offer_close_rate',  label: 'Offer Close %', type: 'pct', bench: 'offer_close_rate',  get: (r) => r.d.offer_close_rate },
      { key: 'call_commit_rate',  label: 'Call Cmt %',    type: 'pct', bench: 'call_commit_rate',  get: (r) => r.d.call_commit_rate },
      { key: 'call_close_rate',   label: 'Call Close %',  type: 'pct', bench: 'call_close_rate',   get: (r) => r.d.call_close_rate },
    ],
  },
  {
    label: 'Revenue',
    cols: [
      { key: 'collected',           label: 'Collected',  type: 'money', get: (r) => r.raw.collected },
      { key: 'total_revenue',       label: 'Revenue',    type: 'money', get: (r) => r.raw.total_revenue },
      { key: 'collected_pct',       label: 'Collected %',type: 'pct',   get: (r) => r.d.collected_pct },
      { key: 'collected_per_offer', label: 'Coll / Offer', type: 'money', get: (r) => r.d.collected_per_offer },
      { key: 'collected_per_call',  label: 'Coll / Call',  type: 'money', get: (r) => r.d.collected_per_call },
      { key: 'revenue_per_offer',   label: 'Rev / Offer',  type: 'money', get: (r) => r.d.revenue_per_offer },
      { key: 'revenue_per_call',    label: 'Rev / Call',   type: 'money', get: (r) => r.d.revenue_per_call },
    ],
  },
  {
    label: 'Commission',
    cols: [
      { key: 'commission', label: 'Commission', type: 'money', get: (r) => r.commission },
    ],
  },
];

const COLS: Col[] = GROUPS.flatMap((g) => g.cols);
const TOTAL_COLS = COLS.length + 1; // +1 for the period label column

// Distinct line colours for chart series.
const C = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const pad2 = (n: number) => String(n).padStart(2, '0');

export default function SalesPerformance({ year, defaultMonth, reps, cells, tiers }: Props) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(reps.map((r) => r.rep_id)));
  const [monthSel, setMonthSel] = useState(defaultMonth);
  const [sort, setSort] = useState<{ col: string | null; dir: 'asc' | 'desc' }>({ col: null, dir: 'asc' });

  // ── Aggregate the selected reps into per-month buckets ──────────────────
  const { monthRaw, monthDerived, repColl, repCount } = useMemo(() => {
    const monthRaw = Array.from({ length: 12 }, emptyRaw);
    const repColl = new Map<string, number[]>();   // rep_id → collected[12]
    const repYearIntro = new Map<string, number>();

    for (const c of cells) {
      if (!checked.has(c.rep_id)) continue;
      addRaw(monthRaw[c.month], c);
      let arr = repColl.get(c.rep_id);
      if (!arr) { arr = new Array(12).fill(0); repColl.set(c.rep_id, arr); }
      arr[c.month] += c.collected;
      repYearIntro.set(c.rep_id, (repYearIntro.get(c.rep_id) ?? 0) + c.intro_calls);
    }

    const repCount = Array.from(repYearIntro.values()).filter((v) => v > 0).length;
    const monthDerived = monthRaw.map(deriveRates);
    return { monthRaw, monthDerived, repColl, repCount };
  }, [cells, checked]);

  const commissionFor = (months: number[]): number => {
    let total = 0;
    for (const arr of repColl.values()) {
      let coll = 0;
      for (const m of months) coll += arr[m];
      total += tieredCommission(coll, tiers);
    }
    return total;
  };

  // ── Build the table rows ────────────────────────────────────────────────
  const { monthRows, quarterRows, totalRow, avgRow } = useMemo(() => {
    const monthRows: Row[] = MONTH_LABELS.map((label, m) => ({
      key: `m-${m}`, label, kind: 'month', monthIndex: m,
      raw: monthRaw[m], d: monthDerived[m], commission: commissionFor([m]),
    }));

    const quarterRows: Row[] = QUARTERS.map((q) => {
      const raw = q.months.reduce((a, m) => addRaw(a, monthRaw[m]), emptyRaw());
      return { key: `q-${q.label}`, label: q.label, kind: 'quarter', raw, d: deriveRates(raw), commission: commissionFor(q.months) };
    });

    const allMonths = Array.from({ length: 12 }, (_, m) => m);
    const totalRaw = allMonths.reduce((a, m) => addRaw(a, monthRaw[m]), emptyRaw());
    const totalCommission = commissionFor(allMonths);
    const totalRow: Row = { key: 'total', label: 'Team Total', kind: 'total', raw: totalRaw, d: deriveRates(totalRaw), commission: totalCommission };

    const denom = Math.max(repCount, 1);
    const avgRaw = scaleRaw(totalRaw, 1 / denom);
    const avgRow: Row = { key: 'avg', label: 'Team Avg / Rep', kind: 'avg', raw: avgRaw, d: deriveRates(avgRaw), commission: totalCommission / denom };

    return { monthRows, quarterRows, totalRow, avgRow };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthRaw, monthDerived, repColl, repCount, tiers]);

  // ── Sort the month rows only (quarters / totals stay pinned) ────────────
  const sortedMonths = useMemo(() => {
    if (!sort.col) return monthRows;
    const col = COLS.find((c) => c.key === sort.col);
    if (!col) return monthRows;
    const arr = [...monthRows];
    arr.sort((a, b) => {
      const av = col.get(a), bv = col.get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sort.dir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [monthRows, sort]);

  // ── Chart series ────────────────────────────────────────────────────────
  const volSeries: Series[] = [
    { label: 'Intro Calls', color: C[0], data: monthRaw.map((r) => r.intro_calls) },
    { label: 'Live Intros', color: C[1], data: monthRaw.map((r) => r.live_intros) },
    { label: 'Offers',      color: C[2], data: monthRaw.map((r) => r.offers_made) },
    { label: 'Deposits',    color: C[3], data: monthRaw.map((r) => r.deposits) },
    { label: 'Closes',      color: C[4], data: monthRaw.map((r) => r.closes) },
  ];
  const rateOf = (k: keyof DerivedRates): number[] => monthDerived.map((d) => d[k] ?? 0);
  const rateSeries: Series[] = [
    { label: 'Show %',       color: C[0], data: rateOf('show_rate') },
    { label: 'Offer %',      color: C[1], data: rateOf('offer_rate') },
    { label: 'Offer Close %',color: C[2], data: rateOf('offer_close_rate') },
    { label: 'Call Cmt %',   color: C[3], data: rateOf('call_commit_rate') },
    { label: 'Call Close %', color: C[4], data: rateOf('call_close_rate') },
  ];
  const revSeries: Series[] = [
    { label: 'Collected',    color: C[0], data: monthRaw.map((r) => r.collected) },
    { label: 'Revenue',      color: C[1], data: monthRaw.map((r) => r.total_revenue) },
    { label: 'Coll / Offer', color: C[2], data: rateOf('collected_per_offer') },
    { label: 'Coll / Call',  color: C[3], data: rateOf('collected_per_call') },
    { label: 'Rev / Offer',  color: C[5], data: rateOf('revenue_per_offer') },
    { label: 'Rev / Call',   color: C[6], data: rateOf('revenue_per_call') },
  ];

  // ── KPI cards (selected month) ──────────────────────────────────────────
  const kpi = monthRaw[monthSel];

  // ── Handlers ────────────────────────────────────────────────────────────
  const toggleRep = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allOn = () => setChecked(new Set(reps.map((r) => r.rep_id)));
  const allOff = () => setChecked(new Set());
  const clickSort = (key: string) =>
    setSort((s) => (s.col === key ? { col: key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: key, dir: 'desc' }));

  const yearHref = (y: number) => `/sales?period=${y}-${pad2(monthSel + 1)}`;

  return (
    <div className="space-y-5">
      {/* ── Top bar: rep checkboxes + month/year selector ─────────────── */}
      <div className="card p-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Reps</span>
            <button onClick={allOn} className="text-[11px] text-indigo-600 hover:underline">All</button>
            <span className="text-slate-300">·</span>
            <button onClick={allOff} className="text-[11px] text-indigo-600 hover:underline">None</button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {reps.length === 0 && <span className="text-xs text-slate-400">No reps with data yet</span>}
            {reps.map((r) => (
              <label key={r.rep_id} className="inline-flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={checked.has(r.rep_id)}
                  onChange={() => toggleRep(r.rep_id)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                {r.rep_name}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a href={yearHref(year - 1)} className="btn-secondary !px-2 !py-1 text-xs" aria-label="Previous year">‹</a>
          <span className="text-sm font-semibold text-slate-900 tabular-nums">{year}</span>
          <a href={yearHref(year + 1)} className="btn-secondary !px-2 !py-1 text-xs" aria-label="Next year">›</a>
          <select
            value={monthSel}
            onChange={(e) => setMonthSel(Number(e.target.value))}
            className="input !w-auto !py-1.5 text-sm ml-1"
          >
            {MONTH_LABELS.map((m, i) => (
              <option key={m} value={i}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── KPI summary cards (selected month) ────────────────────────── */}
      <div>
        <div className="text-xs text-slate-500 mb-2">
          Showing <span className="font-medium text-slate-700">{MONTH_LABELS[monthSel]} {year}</span> · {checked.size} of {reps.length} rep{reps.length === 1 ? '' : 's'}
        </div>
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Intro Calls"     value={fmtNumber(kpi.intro_calls)} />
          <StatCard label="Total Collected" value={fmtCurrency(kpi.collected)} />
          <StatCard label="Live Intros"     value={fmtNumber(kpi.live_intros)} />
          <StatCard label="Closes"          value={fmtNumber(kpi.closes)} />
        </section>
      </div>

      {/* ── Three trend charts (full year) ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <LineChart title="Volume" series={volSeries} xLabels={MONTH_ABBR as unknown as string[]}
          valueFmt={(n) => fmtNumber(Math.round(n))} />
        <LineChart title="Rates" series={rateSeries} xLabels={MONTH_ABBR as unknown as string[]}
          valueFmt={(n) => `${(n * 100).toFixed(0)}%`} />
        <LineChart title="Revenue" series={revSeries} xLabels={MONTH_ABBR as unknown as string[]}
          valueFmt={(n) => fmtCurrency(n)} />
      </div>

      {/* ── Main data table ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Performance by period</h2>
        <ExportButton table="sales" from={`${year}-01-01`} to={`${year}-12-31`} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            {/* Group header row */}
            <tr>
              <th className="sticky left-0 z-20 bg-slate-800 px-3 py-1.5" />
              {GROUPS.map((g) => (
                <th key={g.label} colSpan={g.cols.length}
                    className="bg-slate-800 text-white text-[11px] font-semibold uppercase tracking-wide px-3 py-1.5 text-center border-l border-slate-700">
                  {g.label}
                </th>
              ))}
            </tr>
            {/* Column header row */}
            <tr>
              <th
                onClick={() => setSort({ col: null, dir: 'asc' })}
                className="sticky left-0 z-20 bg-slate-100 text-left text-[11px] font-medium uppercase tracking-wide text-slate-600 px-3 py-2 cursor-pointer whitespace-nowrap border-b border-slate-200"
              >
                Period
              </th>
              {COLS.map((c) => {
                const active = sort.col === c.key;
                return (
                  <th key={c.key}
                      onClick={() => clickSort(c.key)}
                      className="bg-slate-100 text-right text-[11px] font-medium uppercase tracking-wide text-slate-600 px-3 py-2 cursor-pointer whitespace-nowrap select-none hover:text-slate-900 border-b border-slate-200">
                    {c.label}
                    <span className="ml-0.5 text-slate-400">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <GroupRow label="By Month" />
            {sortedMonths.map((r, i) => (
              <DataRow key={r.key} r={r} stripe={i % 2 === 1} />
            ))}

            <GroupRow label="By Quarter" />
            {quarterRows.map((r) => <DataRow key={r.key} r={r} />)}

            <GroupRow label="Totals" />
            <DataRow r={totalRow} />
            <DataRow r={avgRow} />
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Rates shown green when at/above benchmark, red below
        (Show {pct(RATE_BENCHMARKS.show_rate)} · Offer {pct(RATE_BENCHMARKS.offer_rate)} ·
        Offer-Close {pct(RATE_BENCHMARKS.offer_close_rate)} · Call-Cmt {pct(RATE_BENCHMARKS.call_commit_rate)} ·
        Call-Close {pct(RATE_BENCHMARKS.call_close_rate)}).
        Commission uses {(tiers.t1 * 100).toFixed(0)}/{(tiers.t2 * 100).toFixed(1)}/{(tiers.t3 * 100).toFixed(0)}% tiers, per rep per period.
      </p>
    </div>
  );
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

function GroupRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={TOTAL_COLS} className="bg-slate-700 text-white text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5">
        <span className="sticky left-3">{label}</span>
      </td>
    </tr>
  );
}

function DataRow({ r, stripe }: { r: Row; stripe?: boolean }) {
  const isSummary = r.kind === 'total' || r.kind === 'avg';
  const rowBg = isSummary ? 'bg-slate-100' : r.kind === 'quarter' ? 'bg-indigo-50/40' : stripe ? 'bg-slate-50/60' : 'bg-white';
  const labelWeight = isSummary || r.kind === 'quarter' ? 'font-semibold text-slate-900' : 'font-medium text-slate-800';

  return (
    <tr className={rowBg}>
      <td className={`sticky left-0 z-10 ${rowBg} ${labelWeight} px-3 py-2 whitespace-nowrap border-b border-slate-100`}>
        {r.label}
      </td>
      {COLS.map((c) => {
        const v = c.get(r);
        let text: string;
        if (c.type === 'int') text = fmtNumber(v ?? 0, { maximumFractionDigits: r.kind === 'avg' ? 1 : 0 });
        else if (c.type === 'money') text = v == null ? '—' : fmtCurrency(v);
        else text = fmtPct(v);

        let color = isSummary ? 'text-slate-900' : 'text-slate-700';
        if (c.type === 'pct' && c.bench) {
          color = v == null ? 'text-slate-300' : v >= RATE_BENCHMARKS[c.bench] ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold';
        }

        return (
          <td key={c.key} className={`text-right tabular-nums px-3 py-2 whitespace-nowrap border-b border-slate-100 ${color}`}>
            {text}
          </td>
        );
      })}
    </tr>
  );
}
