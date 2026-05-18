/** Display formatters. All accept null/undefined and render a dash. */

export const DASH = '—';

export function fmtNumber(n: number | null | undefined, opts: Intl.NumberFormatOptions = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH;
  return new Intl.NumberFormat('en-CA', opts).format(n);
}

export function fmtCurrency(n: number | null | undefined, currency = 'CAD'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

export function fmtMoney(n: number | null | undefined): string {
  return fmtCurrency(n, 'CAD');
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH;
  // Accepts either 0.42 or 42 — treats < 1.5 as fraction, else as percent.
  const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
  return `${pct.toFixed(digits)}%`;
}

export function fmtDateISO(d: Date | string | null | undefined): string {
  if (!d) return DASH;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toISOString().slice(0, 10);
}
