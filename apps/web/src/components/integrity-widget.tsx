'use client';
import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { BotLive } from '@/lib/queries';

const STATUS_LABEL: Record<string, string> = {
  open: 'Open on Binance',
  pending: 'Awaiting placement',
  ignored_balance: 'Insufficient balance',
  post_only_rejected: 'Too close to market',
  price_too_far: 'Too far from market',
  min_notional: 'Below MIN_NOTIONAL',
  bad_price: 'Tick filter failure',
  bad_qty: 'Step filter failure',
  error: 'Generic error',
};

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-success/15 text-success border-success/30',
  pending: 'bg-muted text-muted-foreground',
  ignored_balance: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  post_only_rejected: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  price_too_far: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  min_notional: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  bad_price: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
  bad_qty: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
  error: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function IntegrityWidget({ live }: { live: BotLive }) {
  const { integrity } = live;
  const pct = integrity.total > 0 ? (integrity.open / integrity.total) * 100 : 0;
  const healthy = integrity.failed === 0 && integrity.total > 0;

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsToNext = integrity.nextReconcileAtMs
    ? Math.max(0, Math.round((integrity.nextReconcileAtMs - now) / 1000))
    : null;

  return (
    <Card className={`shadow-md border-2 ${healthy ? 'border-success/30' : integrity.total > 0 ? 'border-yellow-500/40' : 'border-border'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {healthy ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : integrity.total > 0 ? (
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
            ) : (
              <Activity className="h-4 w-4 text-muted-foreground" />
            )}
            Grid integrity
          </CardTitle>
          {secondsToNext !== null && (
            <Badge variant="outline" className="text-[10px] font-mono">
              next check in {secondsToNext}s
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          {healthy
            ? 'All grid levels are open on Binance.'
            : integrity.total === 0
              ? 'No grid state yet.'
              : 'Some levels need repair — the integrity loop will retry every minute.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Big counter */}
        <div className="flex items-baseline gap-3">
          <div className="text-4xl font-bold tabular-nums">
            {integrity.open}<span className="text-muted-foreground text-2xl font-normal">/{integrity.total}</span>
          </div>
          <div className="text-sm text-muted-foreground">levels open</div>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${healthy ? 'bg-success' : 'bg-yellow-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Status breakdown */}
        {Object.keys(integrity.breakdown).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(integrity.breakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([status, count]) => (
                <span
                  key={status}
                  className={`text-[10px] font-mono px-2 py-1 rounded-md border ${
                    STATUS_COLOR[status] ?? 'bg-muted text-muted-foreground border-border'
                  }`}
                  title={STATUS_LABEL[status] ?? status}
                >
                  {status}={count}
                </span>
              ))}
          </div>
        )}

        {/* Latest integrity event */}
        {integrity.latestEvent && (
          <div className="text-xs border-l-2 border-primary/40 pl-3 py-1">
            <div className="flex items-center gap-2 mb-0.5">
              <Badge variant="outline" className="text-[9px]">{integrity.latestEvent.type}</Badge>
              <span className="text-[10px] text-muted-foreground">
                {new Date(integrity.latestEvent.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-muted-foreground">{integrity.latestEvent.message}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
