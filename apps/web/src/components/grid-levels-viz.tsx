'use client';
import { LayoutGrid } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Visual ladder of all grid orders. Each rung is a row colored by status,
 * with a horizontal marker showing the current market price relative to
 * the price range. Sorted price desc (highest at top).
 */
export function GridLevelsViz({ live }: { live: BotLive }) {
  const orders = live.orders ?? [];
  if (orders.length === 0) {
    return (
      <Card className="shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-primary" />
            Grid Levels
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">No orders.</p>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...orders].sort((a, b) => Number(b.price) - Number(a.price));
  const prices = sorted.map((o) => Number(o.price));
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const market = live.marketPrice ? Number(live.marketPrice) : null;
  const marketPct = market !== null ? ((maxP - market) / range) * 100 : null;
  const avg = live.pnl.breakEvenPrice;
  const avgPct = avg !== null ? ((maxP - avg) / range) * 100 : null;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-primary" />
          Grid Levels
          <Badge variant="outline" className="text-[10px]">{orders.length} rungs</Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Range {formatNumber(minP)} — {formatNumber(maxP)}
          {market !== null && <> · market <span className="font-mono">{formatNumber(market)}</span></>}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="relative max-h-[480px] overflow-y-auto">
          {/* Market line */}
          {marketPct !== null && marketPct >= 0 && marketPct <= 100 && (
            <div
              className="absolute left-0 right-0 z-10 pointer-events-none"
              style={{ top: `${marketPct}%` }}>
              <div className="h-px bg-yellow-500/70" />
              <div className="absolute -top-2 right-2 text-[10px] bg-yellow-500/90 text-black px-1.5 rounded font-mono">
                MKT {formatNumber(market!)}
              </div>
            </div>
          )}
          {/* Avg cost line */}
          {avgPct !== null && avgPct >= 0 && avgPct <= 100 && (
            <div
              className="absolute left-0 right-0 z-10 pointer-events-none"
              style={{ top: `${avgPct}%` }}>
              <div className="h-px border-t border-dashed border-primary/70" />
              <div className="absolute -top-2 left-2 text-[10px] bg-primary/90 text-primary-foreground px-1.5 rounded font-mono">
                AVG {formatNumber(avg!)}
              </div>
            </div>
          )}
          <table className="w-full text-xs">
            <tbody className="font-mono tabular-nums">
              {sorted.map((o, i) => (
                <tr key={i} className={`border-b last:border-0 ${rowBg(o.status)}`}>
                  <td className="px-3 py-1">
                    <Badge variant={o.side === 'BUY' ? 'success' : 'destructive'} className="text-[9px]">
                      {o.side}
                    </Badge>
                  </td>
                  <td className="text-right px-3 py-1">{formatNumber(Number(o.price))}</td>
                  <td className="text-right px-3 py-1">{formatNumber(Number(o.quantity), { maximumFractionDigits: 6 })}</td>
                  <td className="px-3 py-1">
                    <span className={`text-[9px] font-semibold uppercase ${statusFg(o.status)}`}>
                      {o.status}
                    </span>
                    {o.errorCategory && (
                      <span className="text-[9px] text-destructive ml-1.5">({o.errorCategory})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function rowBg(status: string): string {
  if (status === 'open') return 'bg-success/5';
  if (status === 'pending') return 'bg-muted/20';
  if (status === 'post_only_rejected' || status === 'price_too_far') return 'bg-amber-500/10';
  return 'bg-destructive/5';
}
function statusFg(status: string): string {
  if (status === 'open') return 'text-success';
  if (status === 'pending') return 'text-muted-foreground';
  if (status === 'post_only_rejected' || status === 'price_too_far') return 'text-amber-500';
  return 'text-destructive';
}
