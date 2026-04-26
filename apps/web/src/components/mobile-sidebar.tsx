'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, CreditCard, FlaskConical, Key, LayoutDashboard, LineChart, Menu, Settings, Shield, Wallet, Workflow, X } from 'lucide-react';
import { useMe } from '@/lib/queries';
import { Button } from '@/components/ui/button';
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

export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { data: me } = useMe();
  const isAdmin = me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN';

  return (
    <>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)}>
        <Menu className="h-5 w-5" />
      </Button>

      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative w-64 h-full bg-card border-r flex flex-col p-4 animate-slide-in">
            <div className="flex items-center justify-between mb-4">
              <Link href="/dashboard" className="flex items-center gap-2" onClick={() => setOpen(false)}>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">🐋</div>
                <span className="text-xl font-bold">Orca</span>
              </Link>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="flex-1 space-y-1">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
                    )}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
              {isAdmin && (
                <Link href="/admin" onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors mt-4 border-t pt-4',
                    pathname.startsWith('/admin') ? 'bg-warning/10 text-warning' : 'text-muted-foreground hover:bg-accent/50',
                  )}>
                  <Shield className="h-4 w-4" />Admin Panel
                </Link>
              )}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
