'use client';
import Link from 'next/link';
import { Sparkles, AlertCircle } from 'lucide-react';
import { useMe } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';

export function TrialBanner() {
  const { data: me } = useMe();
  const { t } = useI18n();

  if (!me?.trialEndsAt) return null;
  const ends = new Date(me.trialEndsAt).getTime();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((ends - now) / dayMs);

  if (daysLeft <= 0) {
    return (
      <div className="bg-destructive text-destructive-foreground px-4 py-2 text-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          <span>{t('trial.expired')}</span>
        </div>
        <Link
          href="/billing"
          className="font-semibold underline-offset-4 hover:underline"
        >
          {t('trial.cta')} →
        </Link>
      </div>
    );
  }

  const ending = daysLeft <= 3;
  const cls = ending
    ? 'bg-yellow-500/15 border-b border-yellow-500/30 text-yellow-200'
    : 'bg-primary/10 border-b border-primary/20 text-foreground';

  return (
    <div className={`${cls} px-4 py-2 text-sm flex items-center justify-between gap-3`}>
      <div className="flex items-center gap-2">
        {ending ? <AlertCircle className="h-4 w-4" /> : <Sparkles className="h-4 w-4 text-primary" />}
        <span>
          {ending ? t('trial.ending') : t('trial.active', { days: daysLeft })}
        </span>
      </div>
      <Link
        href="/billing"
        className="font-semibold text-primary hover:underline"
      >
        {t('trial.cta')} →
      </Link>
    </div>
  );
}
