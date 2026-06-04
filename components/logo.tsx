/** Mission Control wordmark — green gradient mark + text. Server-safe, no state. */
export default function Logo({
  className = '',
  showText = true,
  size = 'md',
}: {
  className?: string;
  showText?: boolean;
  size?: 'sm' | 'md';
}) {
  const mark = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        className={`grid ${mark} shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft`}
      >
        {/* mission-control radar/target glyph */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" opacity="0.5" />
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      {showText && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-bold tracking-tight text-slate-900">
            Mission Control
          </span>
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
            Growth OS
          </span>
        </span>
      )}
    </span>
  );
}
