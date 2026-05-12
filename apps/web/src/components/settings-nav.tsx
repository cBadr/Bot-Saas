'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  User as UserIcon, Shield, KeyRound, Bell, SlidersHorizontal,
  Share2, CreditCard, AlertTriangle, Search,
} from 'lucide-react';
import { Input } from '@/components/ui/input';

export interface SettingsTab {
  href: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  keywords: string[];  // for search
}

export const SETTINGS_TABS: SettingsTab[] = [
  { href: '/settings', label: 'Profile', desc: 'Name, email, avatar', icon: UserIcon,
    keywords: ['profile', 'name', 'email', 'avatar', 'account'] },
  { href: '/settings/security', label: 'Security', desc: '2FA, sessions, audit log', icon: Shield,
    keywords: ['2fa', 'mfa', 'password', 'sessions', 'devices', 'audit', 'login'] },
  { href: '/settings/api-keys', label: 'API Keys', desc: 'Exchange API keys', icon: KeyRound,
    keywords: ['api', 'keys', 'binance', 'exchange', 'secret'] },
  { href: '/settings/notifications', label: 'Notifications', desc: 'Channels, frequency, mute', icon: Bell,
    keywords: ['notifications', 'telegram', 'email', 'discord', 'push', 'mute', 'digest', 'quiet hours'] },
  { href: '/settings/preferences', label: 'Preferences', desc: 'Theme, language, timezone', icon: SlidersHorizontal,
    keywords: ['preferences', 'theme', 'locale', 'language', 'timezone', 'density', 'currency', 'date'] },
  { href: '/settings/referrals', label: 'Referrals', desc: 'Invite friends', icon: Share2,
    keywords: ['referral', 'invite', 'share', 'code'] },
  { href: '/settings/billing', label: 'Billing', desc: 'Plan & invoices', icon: CreditCard,
    keywords: ['billing', 'plan', 'subscription', 'invoice', 'payment'] },
  { href: '/settings/danger-zone', label: 'Danger Zone', desc: 'Export & delete', icon: AlertTriangle, danger: true,
    keywords: ['danger', 'delete', 'export', 'gdpr', 'remove'] },
];

/** Vertical sidebar navigation for /settings/* pages with a built-in search. */
export function SettingsNav() {
  const path = usePathname();
  const [q, setQ] = useState('');
  const tabs = useMemo(() => {
    if (!q.trim()) return SETTINGS_TABS;
    const needle = q.toLowerCase();
    return SETTINGS_TABS.filter((t) =>
      t.label.toLowerCase().includes(needle)
      || t.desc.toLowerCase().includes(needle)
      || t.keywords.some((k) => k.includes(needle)));
  }, [q]);

  return (
    <nav className="space-y-2 md:sticky md:top-4">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search settings…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9 h-9 text-sm"
        />
      </div>
      <div className="space-y-1">
        {tabs.map((t) => {
          const active = t.href === '/settings'
            ? path === '/settings'
            : path?.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted/50 text-foreground/80'
              } ${t.danger ? 'hover:bg-destructive/10 hover:text-destructive' : ''}`}
            >
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${t.danger && active ? 'text-destructive' : ''}`} />
              <div className="min-w-0 flex-1">
                <div className={`truncate ${t.danger && active ? 'text-destructive' : ''}`}>{t.label}</div>
                <div className="text-[10px] text-muted-foreground truncate">{t.desc}</div>
              </div>
            </Link>
          );
        })}
        {tabs.length === 0 && (
          <p className="text-xs text-muted-foreground italic px-3 py-2">No matches.</p>
        )}
      </div>
    </nav>
  );
}
