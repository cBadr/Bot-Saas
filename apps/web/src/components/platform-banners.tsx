'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, AlertTriangle, Info, UserX } from 'lucide-react';
import { tokenStore } from '@/lib/api';
import { useMe } from '@/lib/queries';

/**
 * Platform-wide banners that sit at the very top of the dashboard:
 *   • Impersonation strip (when an admin is logged in as another user)
 *   • Announcement banner (admin-set message for all users)
 *
 * Both render conditionally and stack — no layout shift when absent.
 */
export function PlatformBanners() {
  const { data: me } = useMe();
  const [impersonatedEmail, setImpersonatedEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setImpersonatedEmail(tokenStore.impersonatedEmail);
  }, [me?.id]);

  const exitImpersonation = () => {
    tokenStore.exitImpersonation();
    if (typeof window !== 'undefined') window.location.href = '/admin/users';
    void router;  // kept for ESLint
  };

  if (!impersonatedEmail && !me?.announcement) return null;

  return (
    <div className="sticky top-0 z-40">
      {impersonatedEmail && (
        <div className="bg-destructive text-destructive-foreground px-4 py-2 text-sm flex items-center gap-2">
          <UserX className="h-4 w-4" />
          <span>
            Impersonating <strong className="font-mono">{impersonatedEmail}</strong>
          </span>
          <button
            onClick={exitImpersonation}
            className="ml-auto px-2 py-0.5 rounded bg-destructive-foreground/20 hover:bg-destructive-foreground/30 text-xs font-medium">
            Exit impersonation
          </button>
        </div>
      )}
      {me?.announcement && <AnnouncementBar a={me.announcement} />}
    </div>
  );
}

function AnnouncementBar({ a }: {
  a: { message: string; severity: 'info' | 'warning' | 'critical' };
}) {
  const Icon = a.severity === 'critical' ? AlertCircle
    : a.severity === 'warning' ? AlertTriangle : Info;
  const cls = a.severity === 'critical' ? 'bg-destructive/10 text-destructive border-b border-destructive/30'
    : a.severity === 'warning' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-b border-amber-500/30'
    : 'bg-primary/10 text-primary border-b border-primary/30';
  return (
    <div className={`${cls} px-4 py-2 text-sm flex items-center gap-2`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span>{a.message}</span>
    </div>
  );
}
