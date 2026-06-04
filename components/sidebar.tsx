import Link from 'next/link';
import { cookies } from 'next/headers';
import { COOKIE, verify } from '@/lib/auth/session';
import Logo from './logo';
import {
  IconChart, IconUsers, IconWallet, IconSettings, IconBox, IconLock,
  IconFunnel, IconSparkle, IconTarget, IconBolt,
} from './icons';

type Item = { href: string; label: string; Icon: typeof IconChart; lock?: boolean };
type Group = { heading: string; items: Item[] };

/**
 * Server component sidebar — hides /financials from nav unless the user
 * has the second-tier cookie set and it verifies.
 */
export default async function Sidebar({ current }: { current?: string }) {
  const secret = process.env.SESSION_SECRET;
  const finCookie = cookies().get(COOKIE.financials)?.value;
  const hasFinancials = !!secret && (await verify(finCookie, 'financials', secret));

  const groups: Group[] = [
    {
      heading: 'Analytics',
      items: [
        { href: '/dashboard',          label: 'Ad Attribution', Icon: IconChart   },
        { href: '/dashboard/funnel',   label: 'Funnel',         Icon: IconFunnel  },
        { href: '/dashboard/insights', label: 'Insights',       Icon: IconTarget  },
        { href: '/dashboard/ask',      label: 'Ask AI',         Icon: IconSparkle },
        { href: '/dashboard/capi-log', label: 'CAPI Log',       Icon: IconBolt    },
      ],
    },
    {
      heading: 'Pipeline',
      items: [
        { href: '/leads',                label: 'Leads',              Icon: IconUsers  },
        { href: '/sales',                label: 'Sales',              Icon: IconChart  },
        { href: '/sales-opportunities',  label: 'Sales Opportunities', Icon: IconTarget },
        { href: '/clients',              label: 'Clients',            Icon: IconBox    },
      ],
    },
    {
      heading: 'Admin',
      items: [
        ...(hasFinancials
          ? [{ href: '/financials', label: 'Financials', Icon: IconWallet, lock: true } as Item]
          : []),
        { href: '/settings', label: 'Settings', Icon: IconSettings },
      ],
    },
  ];

  // Active = the item whose href is the longest prefix of `current`
  // (so /dashboard doesn't light up while on /dashboard/funnel).
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const activeHref = allHrefs
    .filter((h) => current === h || (current ?? '').startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="px-5 py-5">
        <Link href="/dashboard" aria-label="Mission Control home">
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.heading}>
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {group.heading}
            </div>
            <div className="space-y-0.5">
              {group.items.map(({ href, label, Icon, lock }) => {
                const active = href === activeHref;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`nav-link ${active ? 'nav-link-active' : ''}`}
                  >
                    <Icon className={active ? 'text-brand-600' : 'text-slate-400'} width={17} height={17} />
                    <span className="flex-1">{label}</span>
                    {lock && <IconLock className="text-slate-400" width={13} height={13} />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-100 p-3">
        <form action="/logout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
