'use client';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber, formatRelativeTime } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Single consolidated card for everything about order health:
 *   • health bar (% of planned rungs actually open)
 *   • breakdown by status (open / pending / errors with category)
 *   • list of failing orders with reason
 *   • latest integrity event
 *
 * Replaces the three separate cards (IntegrityWidget + DesiredVsActual + OrderHealthPanel)
 * which were showing overlapping data on the same page.
 */
export function OrdersHealthCard({ live }: { live: BotLive }) {
  const orders = live.orders ?? [];
  const breakdown = live.integrity.breakdown ?? {};
  const planned = live.config.gridLevels ?? orders.length;
  const open = breakdown['open'] ?? 0;
  const pending = breakdown['pending'] ?? 0;
  const failed = orders.filter((o) => o.status !== 'open' && o.status !== 'pending');
  const healthPct = planned > 0 ? (open / planned) * 100 : 0;
  const allClear = failed.length === 0;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {allClear
            ? <ShieldCheck className="h-4 w-4 text-success" />
            : <ShieldAlert className="h-4 w-4 text-destructive" />}
          Orders & Health
          <Badge
            variant={allClear ? 'success' : 'destructive'}
            className="text-[10px] ml-auto">
            {allClear ? 'all clear' : `${failed.length} issue${failed.length === 1 ? '' : 's'}`}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          {open}/{planned} rungs working ({healthPct.toFixed(0)}%) ·{' '}
          auto-retried by the integrity loop every ~60s.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Health bar */}
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all ${
                healthPct >= 90 ? 'bg-success' : healthPct >= 60 ? 'bg-amber-500' : 'bg-destructive'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, healthPct))}%` }}
            />
          </div>
        </div>

        {/* Status pills */}
        <div className="flex flex-wrap gap-1.5">
          <StatusPill label="open" count={open} tone="success" />
          {pending > 0 && <StatusPill label="pending" count={pending} tone="muted" />}
          {Object.entries(breakdown)
            .filter(([k, v]) => k !== 'open' && k !== 'pending' && v > 0)
            .map(([k, v]) => (
              <StatusPill key={k} label={k} count={v} tone="destructive" />
            ))}
        </div>

        {/* Failure details */}
        {!allClear && (
          <div className="rounded-md border bg-destructive/5 max-h-[220px] overflow-y-auto">
            {failed.map((o, i) => (
              <div key={i} className="px-2.5 py-1.5 border-b last:border-0 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={o.side === 'BUY' ? 'success' : 'destructive'} className="text-[9px]">{o.side}</Badge>
                  <span className="font-mono">
                    {formatNumber(Number(o.quantity), { maximumFractionDigits: 6 })} @ {formatNumber(Number(o.price))}
                  </span>
                  <Badge variant="outline" className="text-[9px] text-destructive border-destructive/40 font-mono ml-auto">
                    {o.errorCategory ?? o.status}
                  </Badge>
                </div>
                {o.errorMsg && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">
                    {o.errorMsg}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Latest integrity event */}
        {live.integrity.latestEvent && (
          <div className="text-[11px] text-muted-foreground border-t pt-2 flex items-center justify-between gap-2">
            <span className="truncate">
              <Badge variant="outline" className="text-[9px] font-mono mr-1.5">
                {live.integrity.latestEvent.type}
              </Badge>
              {live.integrity.latestEvent.message}
            </span>
            <span className="whitespace-nowrap">{formatRelativeTime(live.integrity.latestEvent.createdAt)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ label, count, tone }: {
  label: string; count: number; tone: 'success' | 'muted' | 'destructive';
}) {
  const cls = tone === 'success' ? 'bg-success/15 text-success'
    : tone === 'destructive' ? 'bg-destructive/15 text-destructive'
    : 'bg-muted text-muted-foreground';
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${cls}`}>
      {label} · {count}
    </span>
  );
}
