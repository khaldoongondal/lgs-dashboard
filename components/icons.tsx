/** Tiny inline-SVG icon set so we don't pull in a dependency. */

type Props = React.SVGProps<SVGSVGElement>;

const base: Props = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const IconSparkle = (p: Props) => (
  <svg {...base} {...p}><path d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4L12 3z" /><path d="M19 14l.8 2L22 17l-2.2 1L19 20l-.8-2L16 17l2.2-1L19 14z" /></svg>
);
export const IconChart = (p: Props) => (
  <svg {...base} {...p}><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-6" /></svg>
);
export const IconUsers = (p: Props) => (
  <svg {...base} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 20a5 5 0 0 1 6 0" /></svg>
);
export const IconWallet = (p: Props) => (
  <svg {...base} {...p}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12h3" /><path d="M3 9h13a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H3" /></svg>
);
export const IconSettings = (p: Props) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
);
export const IconLock = (p: Props) => (
  <svg {...base} {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V8a4 4 0 1 1 8 0v3" /></svg>
);
export const IconFunnel = (p: Props) => (
  <svg {...base} {...p}><path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" /></svg>
);
export const IconCalendar = (p: Props) => (
  <svg {...base} {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
);
export const IconArrowUpRight = (p: Props) => (
  <svg {...base} {...p}><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
);
export const IconArrowDownRight = (p: Props) => (
  <svg {...base} {...p}><path d="M7 7l10 10" /><path d="M17 8v9H8" /></svg>
);
export const IconChevron = (p: Props) => (
  <svg {...base} {...p}><path d="m9 6 6 6-6 6" /></svg>
);
export const IconBox = (p: Props) => (
  <svg {...base} {...p}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
);
export const IconRefresh = (p: Props) => (
  <svg {...base} {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
);
