'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  LayoutDashboard, Users, Bot, BarChart3, CreditCard, Tag, Package,
  Bell, Mail, MessageSquare, ShieldCheck, Activity, Lock, Settings, Flag, History,
  Shield, AlertTriangle, ChevronRight, TrendingUp, DollarSign,
} from 'lucide-react';
import { useMe } from '@/lib/queries';
import { useAdminStats, useAdminAlerts, useApprovals } from '@/lib/queries-v2';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: (ctx: BadgeCtx) => { value: string | number; tone?: 'warning' | 'critical' | 'info' } | null;
};

type BadgeCtx = {
  alerts: number;
  pendingApprovals: number;
  pendingPayments: number;
  failedPayments24h: number;
  errors1h: number;
  botsStuck: number;
};

type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: '',
    items: [
      {
        href: '/admin', label: 'Overview', icon: LayoutDashboard,
        badge: (c) => c.alerts > 0 ? { value: c.alerts, tone: 'critical' } : null,
      },
    ],
  },
  {
    label: 'Users & Bots',
    items: [
      { href: '/admin/users', label: 'Users', icon: Users },
      {
        href: '/admin/bots', label: 'Bots', icon: Bot,
        badge: (c) => c.botsStuck > 0 ? { value: c.botsStuck, tone: 'warning' } : null,
      },
      { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Revenue',
    items: [
      {
        href: '/admin/payments', label: 'Payments', icon: CreditCard,
        badge: (c) => c.failedPayments24h > 0
          ? { value: c.failedPayments24h, tone: 'critical' }
          : c.pendingPayments > 0
            ? { value: c.pendingPayments, tone: 'warning' }
            : null,
      },
      { href: '/admin/plans', label: 'Plans', icon: Package },
      { href: '/admin/coupons', label: 'Coupons', icon: Tag },
    ],
  },
  {
    label: 'Engagement',
    items: [
      { href: '/admin/announcement', label: 'Announcement', icon: Bell },
      { href: '/admin/email-templates', label: 'Email Templates', icon: Mail },
      { href: '/admin/surveys', label: 'Feedback / NPS', icon: MessageSquare },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        href: '/admin/approvals', label: 'Approvals', icon: ShieldCheck,
        badge: (c) => c.pendingApprovals > 0 ? { value: c.pendingApprovals, tone: 'warning' } : null,
      },
      {
        href: '/admin/system', label: 'System', icon: Activity,
        badge: (c) => c.errors1h > 0 ? { value: c.errors1h, tone: 'critical' } : null,
      },
      { href: '/admin/audit', label: 'Audit Log', icon: History },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/admin/security', label: 'Security', icon: Lock },
      { href: '/admin/settings', label: 'Settings', icon: Settings },
      { href: '/admin/flags', label: 'Feature Flags', icon: Flag },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const { data: stats } = useAdminStats();
  const { data: alerts } = useAdminAlerts();
  const { data: approvals } = useApprovals('pending');

  useEffect(() => {
    if (!isLoading && me && me.role !== 'ADMIN' && me.role !== 'SUPER_ADMIN') {
      router.replace('/dashboard');
    }
  }, [me, isLoading, router]);

  if (isLoading || !me) return null;
  if (me.role !== 'ADMIN' && me.role !== 'SUPER_ADMIN') return null;

  const badgeCtx: BadgeCtx = {
    alerts: alerts?.length ?? 0,
    pendingApprovals: approvals?.length ?? 0,
    pendingPayments: stats?.payments.pending ?? 0,
    failedPayments24h: stats?.payments.failed24h ?? 0,
    errors1h: stats?.health.errors1h ?? 0,
    botsStuck: stats?.bots.stuck ?? 0,
  };

  // Find current section for breadcrumb
  const allItems = GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.label })));
  const currentItem = allItems.find((it) =>
    it.href === '/admin' ? pathname === '/admin' : pathname?.startsWith(it.href),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr] max-w-[1400px]">
      {/* ───────────── Sidebar ───────────── */}
      <aside className="lg:sticky lg:top-4 lg:self-start space-y-3">
        <div className="px-3 py-3 rounded-md border bg-card">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm">Admin Console</div>
              <div className="text-[10px] text-muted-foreground truncate">{me.email}</div>
            </div>
          </div>
          <SidebarPulse stats={stats} alerts={alerts?.length ?? 0} />
        </div>

        <nav className="space-y-3">
          {GROUPS.map((g) => (
            <div key={g.label || 'main'}>
              {g.label && (
                <div className="px-2 mb-1 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {g.label}
                </div>
              )}
              <div className="space-y-0.5">
                {g.items.map((item) => {
                  const active = item.href === '/admin'
                    ? pathname === '/admin'
                    : pathname?.startsWith(item.href);
                  const Icon = item.icon;
                  const badge = item.badge?.(badgeCtx) ?? null;
                  return (
                    <Link key={item.href} href={item.href}
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors',
                        active
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground/70 hover:bg-muted/50 hover:text-foreground',
                      )}>
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {badge && (
                        <span className={cn(
                          'text-[10px] font-mono px-1.5 py-0.5 rounded-full font-semibold',
                          badge.tone === 'critical' ? 'bg-destructive/15 text-destructive'
                          : badge.tone === 'warning' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-primary/15 text-primary',
                        )}>
                          {badge.value}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* ───────────── Main ───────────── */}
      <main className="min-w-0 space-y-5">
        {/* Breadcrumb + page title */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link href="/admin" className="hover:text-foreground">Admin</Link>
            {currentItem && currentItem.href !== '/admin' && (
              <>
                <ChevronRight className="h-3 w-3" />
                {currentItem.group && (
                  <>
                    <span>{currentItem.group}</span>
                    <ChevronRight className="h-3 w-3" />
                  </>
                )}
                <span className="text-foreground">{currentItem.label}</span>
              </>
            )}
          </div>
          {currentItem && (
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-bold">{currentItem.label}</h1>
              {currentItem.href === '/admin/approvals' && approvals && approvals.length > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {approvals.length} pending
                </span>
              )}
              {currentItem.href === '/admin/system' && (stats?.health.errors1h ?? 0) > 0 && (
                <span className="text-xs text-destructive">{stats?.health.errors1h} errors in last hour</span>
              )}
            </div>
          )}
        </div>

        {/* Live alerts strip (always visible when any alerts exist) */}
        {alerts && alerts.length > 0 && pathname !== '/admin' && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex items-center gap-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span>{alerts.length} active alert{alerts.length === 1 ? '' : 's'}</span>
            <Link href="/admin" className="ml-auto text-primary hover:underline">View →</Link>
          </div>
        )}

        {children}
      </main>
    </div>
  );
}

function SidebarPulse({ stats, alerts }: {
  stats: ReturnType<typeof useAdminStats>['data']; alerts: number;
}) {
  if (!stats) return null;
  return (
    <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
      <Pulse icon={<Users className="h-3 w-3" />} value={stats.users.total} label="Users" />
      <Pulse icon={<TrendingUp className="h-3 w-3" />} value={stats.bots.running} label="Live" tone="positive" />
      <Pulse icon={<DollarSign className="h-3 w-3" />} value={`$${Math.round(stats.revenue.mrr)}`} label="MRR" />
      {alerts > 0 && (
        <div className="col-span-3 mt-1 flex items-center gap-1 text-[10px] text-destructive justify-center">
          <AlertTriangle className="h-3 w-3" />
          <span className="font-medium">{alerts} alert{alerts === 1 ? '' : 's'}</span>
        </div>
      )}
    </div>
  );
}

function Pulse({ icon, value, label, tone }: {
  icon: React.ReactNode; value: string | number; label: string; tone?: 'positive';
}) {
  return (
    <div className="rounded-sm bg-muted/40 px-1 py-1.5">
      <div className="flex items-center justify-center gap-0.5 text-muted-foreground">
        {icon}
      </div>
      <div className={cn('text-xs font-bold tabular-nums', tone === 'positive' ? 'text-success' : '')}>
        {value}
      </div>
      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );
}
