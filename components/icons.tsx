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
export const IconCheck = (p: Props) => (
  <svg {...base} {...p}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconX = (p: Props) => (
  <svg {...base} {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);
export const IconBolt = (p: Props) => (
  <svg {...base} {...p}><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" /></svg>
);
export const IconLink = (p: Props) => (
  <svg {...base} {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></svg>
);
export const IconTarget = (p: Props) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>
);
export const IconRocket = (p: Props) => (
  <svg {...base} {...p}><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2a3 3 0 0 0-3-3z" /><path d="M9 11a14 14 0 0 1 7-8c2.5 0 4 .5 4 .5s.5 1.5.5 4a14 14 0 0 1-8 7l-3.5-3.5z" /><path d="M9 11 7 13l4 4 2-2" /><circle cx="15" cy="9" r="1.5" /></svg>
);
export const IconMessage = (p: Props) => (
  <svg {...base} {...p}><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /></svg>
);
export const IconPlay = (p: Props) => (
  <svg {...base} {...p}><path d="M6 4l14 8-14 8V4z" /></svg>
);
export const IconMenu = (p: Props) => (
  <svg {...base} {...p}><path d="M3 6h18M3 12h18M3 18h18" /></svg>
);
export const IconStar = (p: Props) => (
  <svg {...base} fill="currentColor" stroke="none" {...p}><path d="M12 2.5 14.9 8.6 21.5 9.5 16.7 14.1 17.9 20.6 12 17.5 6.1 20.6 7.3 14.1 2.5 9.5 9.1 8.6 12 2.5z" /></svg>
);
export const IconShield = (p: Props) => (
  <svg {...base} {...p}><path d="M12 3 5 6v5c0 4.5 3 7.6 7 9 4-1.4 7-4.5 7-9V6l-7-3z" /><path d="m9 12 2 2 4-4" /></svg>
);
