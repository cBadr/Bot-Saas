'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';

const items = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/plans', label: 'Plans' },
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/flags', label: 'Feature Flags' },
  { href: '/admin/audit', label: 'Audit Log' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && me && me.role !== 'ADMIN' && me.role !== 'SUPER_ADMIN') {
      router.replace('/dashboard');
    }
  }, [me, isLoading, router]);

  if (isLoading || !me) return null;
  if (me.role !== 'ADMIN' && me.role !== 'SUPER_ADMIN') return null;

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="text-muted-foreground">Platform-wide controls. Use with care.</p>
      </div>
      <nav className="flex border-b gap-1 -mb-2">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
