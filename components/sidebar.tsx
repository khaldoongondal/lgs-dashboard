import Link from 'next/link';
import { cookies } from 'next/headers';
import { COOKIE, verify } from '@/lib/auth/session';
import {
  IconChart, IconUsers, IconWallet, IconSettings, IconBox, IconLock,
} from './icons';

/**
 * Server component sidebar — hides /financials from nav unless the user
 * has the second-tier cookie set and it verifies.
 */
export default async function Sidebar({ current }: { current?: string }) {
  const secret = process.env.SESSION_SECRET;
  const finCookie = cookies().get(COOKIE.financials)?.value;
  const hasFinancials = !!secret && (await verify(finCookie, 'financials', secret));

  const items = [
    { href: '/dashboard', label: 'Ad Attribution', Icon: IconChart },
    { href: '/sales',     label: 'Sales',          Icon: IconUsers },
    { href: '/clients',   label: 'Clients',        Icon: IconBox, soon: true },
    ...(hasFinancials
      ? [{ href: '/financials', label: 'Financials', Icon: IconWallet, lock: true }]
      : []),
    { href: '/settings',  label: 'Settings',       Icon: IconSettings },
  ];

  return (
    <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
      <div className="px-5 py-5 border-b border-slate-200">
        <div className="text-xs uppercase tracking-widest text-slate-500">LGS</div>
        <div className="mt-0.5 text-sm font-semibold text-slate-900">Growth Dashboard</div>
      </div>

      <nav className="p-3 space-y-1">
        {items.map(({ href, label, Icon, lock, soon }) => {
          const active = current === href;
          return (
            <Link
              key={href}
              href={soon ? '#' : href}
              aria-disabled={soon}
              className={[
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-slate-900 text-white'
                  : soon
                    ? 'text-slate-400 cursor-not-allowed'
                    : 'text-slate-700 hover:bg-slate-50',
              ].join(' ')}
            >
              <Icon className={active ? 'text-white' : 'text-slate-400'} />
              <span className="flex-1">{label}</span>
              {lock && <IconLock className="text-slate-400" width={14} height={14} />}
              {soon && <span className="text-[10px] uppercase tracking-wide text-slate-400">soon</span>}
            </Link>
          );
        })}
      </nav>

      <div className="absolute bottom-3 left-3 right-3 px-3">
        <form action="/logout" method="post">
          <button type="submit" className="text-xs text-slate-500 hover:text-slate-900">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
