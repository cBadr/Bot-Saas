'use client';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Order health panel: groups orders by status and surfaces failed ones with
 * their error category + message. The integrity loop will retry them every
 * ~60s, so this is informational; no per-order retry button needed (a single
 * "force reconcile" would belong on a global Quick Actions bar instead).
 */
export function OrderHealthPanel({ live }: { live: BotLive }) {
  const orders = live.orders ?? [];
  if (!orders.length) {
    return (
      <Card className="shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Order Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">No orders.</p>
        </CardContent>
      </Card>
    );
  }

  const failed = orders.filter((o) => o.status !== 'open' && o.status !== 'pending');
  const allOk = failed.length === 0;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {allOk
            ? <ShieldCheck className="h-4 w-4 text-success" />
            : <ShieldAlert className="h-4 w-4 text-destructive" />}
          Order Health
          <Badge variant={allOk ? 'success' : 'destructive'} className="text-[10px] ml-auto">
            {allOk ? 'all clear' : `${failed.length} issue${failed.length === 1 ? '' : 's'}`}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Auto-retried by the integrity loop every ~60s.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {allOk ? (
          <p className="text-xs text-muted-foreground italic">All orders are open or pending placement.</p>
        ) : (
          <div className="space-y-2 max-h-[320px] overflow-y-auto">
            {failed.map((o, i) => (
              <div key={i} className="rounded-md border bg-destructive/5 p-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={o.side === 'BUY' ? 'success' : 'destructive'} className="text-[9px]">{o.side}</Badge>
                  <span className="font-mono">{formatNumber(Number(o.quantity), { maximumFractionDigits: 6 })} @ {formatNumber(Number(o.price))}</span>
                  <Badge variant="outline" className="text-[9px] text-destructive border-destructive/40 font-mono">
                    {o.errorCategory ?? o.status}
                  </Badge>
                </div>
                {o.errorMsg && (
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono break-words">
                    {o.errorMsg}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
