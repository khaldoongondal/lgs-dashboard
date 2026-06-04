import Link from 'next/link';

/**
 * Small "Export CSV" link. Drop next to any data table; takes a table key
 * (matching /api/export's whitelist) and an optional date range.
 */
export default function ExportButton({
  table, from, to, label,
}: {
  table: string;
  from?: string;
  to?: string;
  label?: string;
}) {
  const params = new URLSearchParams({ table });
  if (from) params.set('from', from);
  if (to)   params.set('to',   to);
  return (
    <Link
      href={`/api/export?${params.toString()}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-700"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v12" />
        <path d="M6 10l6 6 6-6" />
        <path d="M4 20h16" />
      </svg>
      {label ?? 'Export CSV'}
    </Link>
  );
}
