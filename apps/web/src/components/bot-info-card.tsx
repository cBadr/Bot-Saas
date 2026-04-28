'use client';
import { Info, ArrowDown, ArrowUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Compact info panel showing the key reference numbers a grid operator
 * wants at a glance:
 *   • Start price (the bot's anchor)
 *   • Current market price
 *   • Δ (current − start, both absolute and %)
 *   • Unrealized P&L (floating)
 *   • Order size in BASE coin (computed from orderSize/currentPrice)
 *     × the FDUSD value
 */
export function BotInfoCard({
  live,
  orderSizeQuote,
  baseAsset,
}: {
  live: BotLive;
  orderSizeQuote?: number;
  baseAsset: string;
}) {
  const start = Number(live.initialStartPrice ?? 0);
  const market = Number(live.marketPrice ?? 0);
  const delta = (market && start) ? market - start : 0;
  const deltaPct = (market && start) ? ((market - start) / start) * 100 : 0;
  const deltaPositive = delta >= 0;

  const orderBaseQty = (orderSizeQuote && market)
    ? orderSizeQuote / market
    : 0;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" />
          Bot reference
        </CardTitle>
        <CardDescription className="text-xs">
          Key reference values for the running grid.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Start price + market + delta */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start price">
            <span className="font-mono">
              {start > 0 ? formatNumber(start, { maximumFractionDigits: 2 }) : '—'}
            </span>
          </Field>
          <Field label="Market price">
            <span className="font-mono">
              {market > 0 ? formatNumber(market, { maximumFractionDigits: 2 }) : '—'}
            </span>
          </Field>
        </div>

        {/* Delta */}
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {deltaPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            Δ vs start
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-lg font-semibold font-mono tabular-nums ${
              deltaPositive ? 'text-success' : 'text-destructive'
            }`}>
              {deltaPositive ? '+' : ''}{formatNumber(delta, { maximumFractionDigits: 2 })}
            </span>
            <span className={`text-xs font-mono ${deltaPositive ? 'text-success' : 'text-destructive'}`}>
              ({deltaPositive ? '+' : ''}{deltaPct.toFixed(3)}%)
            </span>
          </div>
        </div>

        {/* Unrealized */}
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Unrealized P&L
          </div>
          <div className="text-lg font-semibold font-mono tabular-nums">
            {live.pnl.unrealized === 0 ? (
              <span className="text-muted-foreground">— FDUSD</span>
            ) : (
              <span className={live.pnl.unrealized > 0 ? 'text-success' : 'text-destructive'}>
                {live.pnl.unrealized > 0 ? '+' : ''}
                {formatNumber(live.pnl.unrealized, { maximumFractionDigits: 4 })}
                <span className="text-xs text-muted-foreground ml-1">FDUSD</span>
              </span>
            )}
          </div>
          {live.pnl.heldQty > 0 && (
            <div className="text-[10px] text-muted-foreground mt-1 font-mono">
              held {formatNumber(live.pnl.heldQty, { maximumFractionDigits: 8 })} {baseAsset}
            </div>
          )}
        </div>

        {/* Order size */}
        {orderSizeQuote ? (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Order size
            </div>
            <div className="font-mono text-sm flex items-baseline gap-1.5">
              <span className="font-semibold">
                {formatNumber(orderBaseQty, { maximumFractionDigits: 8 })}
              </span>
              <span className="text-xs text-muted-foreground">{baseAsset}</span>
              <span className="text-muted-foreground mx-1">≈</span>
              <span className="font-semibold">
                {formatNumber(orderSizeQuote, { maximumFractionDigits: 2 })}
              </span>
              <span className="text-xs text-muted-foreground">FDUSD</span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
}
