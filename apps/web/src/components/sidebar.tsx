'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, CreditCard, FlaskConical, Key, LayoutDashboard, LineChart, Settings, Shield, Wallet, Workflow } from 'lucide-react';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/bots', label: 'Bots', icon: Bot },
  { href: '/strategies', label: 'Strategies', icon: Workflow },
  { href: '/backtest', label: 'Backtest', icon: FlaskConical },
  { href: '/exchange-keys', label: 'API Keys', icon: Key },
  { href: '/reports', label: 'Reports', icon: LineChart },
  { href: '/billing', label: 'Billing', icon: CreditCard },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const isAdmin = me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN';

  return (
    <aside className="hidden md:flex w-64 flex-col border-r bg-card/50 p-4">
      <Link href="/dashboard" className="flex items-center gap-2 px-2 py-3 mb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">🐋</div>
        <span className="text-xl font-bold">Orca</span>
      </Link>
      <nav className="flex-1 space-y-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}>
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
        {isAdmin && (
          <>
            <div className="pt-4 px-3 text-[10px] uppercase text-muted-foreground font-semibold">Admin</div>
            <Link href="/admin"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname.startsWith('/admin') ? 'bg-warning/10 text-warning' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}>
              <Shield className="h-4 w-4" />
              Admin Panel
            </Link>
          </>
        )}
      </nav>
      <div className="border-t pt-4 text-xs text-muted-foreground px-2">
        <p className="font-mono">v0.1.0 · dev</p>
      </div>
    </aside>
  );
}
