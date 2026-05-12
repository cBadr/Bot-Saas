'use client';
import { Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Per-leg breakdown of the open position. Shows every fill that contributes
 * to the current weighted-avg cost basis, with a running avg as you go down
 * (sorted by price desc — easiest read top-down).
 */
export function PositionBreakdownCard({ live, baseAsset, quoteAsset }: {
  live: BotLive; baseAsset: string; quoteAsset: string;
}) {
  const legs = live.pnl.openLegs;
  const avg = live.pnl.breakEvenPrice;
  const mkt = live.marketPrice ? Number(live.marketPrice) : null;

  if (!legs.length) {
    return (
      <Card className="shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Open Position Breakdown
          </CardTitle>
          <CardDescription className="text-xs">
            Legs contributing to weighted-avg cost.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">No open position.</p>
        </CardContent>
      </Card>
    );
  }

  // Compute running avg cost row-by-row (top-to-bottom in display order).
  let cumQty = 0, cumCost = 0;
  const rows = legs.map((leg) => {
    cumQty += leg.qty;
    cumCost += leg.notional;
    return {
      ...leg,
      runningAvg: cumQty > 0 ? cumCost / cumQty : 0,
      pnlAtMarket: mkt ? (mkt - leg.price) * leg.qty * (leg.side === 'BUY' ? 1 : -1) : null,
    };
  });

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          Open Position Breakdown
          <Badge variant="outline" className="text-[10px]">{legs.length} legs</Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Each fill contributing to avg cost
          {avg ? <> · final avg <span className="font-mono">{formatNumber(avg)}</span></> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-3 py-1.5">Side</th>
                <th className="text-right px-3 py-1.5">Price</th>
                <th className="text-right px-3 py-1.5">Qty</th>
                <th className="text-right px-3 py-1.5">Notional</th>
                <th className="text-right px-3 py-1.5">Running Avg</th>
                {mkt !== null && <th className="text-right px-3 py-1.5">P&L @ Mkt</th>}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-1.5">
                    <Badge variant={r.side === 'BUY' ? 'success' : 'destructive'} className="text-[9px]">
                      {r.side}
                    </Badge>
                  </td>
                  <td className="text-right px-3 py-1.5">{formatNumber(r.price)}</td>
                  <td className="text-right px-3 py-1.5">{formatNumber(r.qty, { maximumFractionDigits: 6 })}</td>
                  <td className="text-right px-3 py-1.5">{formatNumber(r.notional, { maximumFractionDigits: 2 })}</td>
                  <td className="text-right px-3 py-1.5 text-muted-foreground">
                    {formatNumber(r.runningAvg)}
                  </td>
                  {mkt !== null && (
                    <td className={`text-right px-3 py-1.5 ${
                      r.pnlAtMarket !== null && r.pnlAtMarket >= 0 ? 'text-success' : 'text-destructive'
                    }`}>
                      {r.pnlAtMarket !== null
                        ? `${r.pnlAtMarket >= 0 ? '+' : ''}${formatNumber(r.pnlAtMarket, { maximumFractionDigits: 4 })}`
                        : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/40 border-t font-semibold">
              <tr>
                <td className="px-3 py-1.5 text-[10px] uppercase text-muted-foreground">Total</td>
                <td className="text-right px-3 py-1.5">—</td>
                <td className="text-right px-3 py-1.5">
                  {formatNumber(cumQty, { maximumFractionDigits: 6 })} <span className="text-[10px] text-muted-foreground">{baseAsset}</span>
                </td>
                <td className="text-right px-3 py-1.5">
                  {formatNumber(cumCost, { maximumFractionDigits: 2 })} <span className="text-[10px] text-muted-foreground">{quoteAsset}</span>
                </td>
                <td className="text-right px-3 py-1.5">
                  {cumQty > 0 ? formatNumber(cumCost / cumQty) : '—'}
                </td>
                {mkt !== null && <td className="text-right px-3 py-1.5">—</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
