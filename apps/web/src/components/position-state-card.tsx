'use client';
import { Wallet, ArrowUp, ArrowDown, Anchor, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Live snapshot of where the bot stands RIGHT NOW:
 *   • Anchor (start price)
 *   • Market price + Δ
 *   • Ladder price range
 *   • Open BUY / SELL counts
 *   • Held / Sold inventory
 *   • Break-even price (DCA — = avgPrice)
 */
export function PositionStateCard({ live, baseAsset }: { live: BotLive; baseAsset: string }) {
  const start = Number(live.initialStartPrice ?? 0);
  const market = Number(live.marketPrice ?? 0);
  const delta = (market && start) ? market - start : 0;
  const deltaPct = (market && start) ? (delta / start) * 100 : 0;
  const deltaPositive = delta >= 0;
  const range = live.derived.priceRange;
  const breakEven = live.pnl.breakEvenPrice;
  const distanceToBreakEven = (breakEven && market)
    ? ((market - breakEven) / breakEven) * 100
    : null;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          Position state
        </CardTitle>
        <CardDescription className="text-xs">
          Current price reference, ladder range, and open inventory.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Anchor + Market + Δ */}
        <Section icon={<Anchor className="h-3 w-3" />} title="Price reference">
          <Row label="Initial start price"
            value={start > 0 ? `$${formatNumber(start, { maximumFractionDigits: 2 })}` : '—'} />
          <Row label="Market price"
            value={market > 0 ? `$${formatNumber(market, { maximumFractionDigits: 2 })}` : '—'} />
          {market > 0 && start > 0 && (
            <Row
              label="Δ vs start"
              value={
                <span className={deltaPositive ? 'text-success' : 'text-destructive'}>
                  {deltaPositive ? '+' : ''}{formatNumber(delta, { maximumFractionDigits: 2 })}
                  <span className="text-[10px] ml-1">
                    ({deltaPositive ? '+' : ''}{deltaPct.toFixed(3)}%)
                  </span>
                </span>
              }
            />
          )}
          {range && (
            <Row
              label="Ladder range"
              value={
                <span className="font-mono">
                  ${formatNumber(range.low, { maximumFractionDigits: 2 })}
                  <span className="text-muted-foreground mx-1">→</span>
                  ${formatNumber(range.high, { maximumFractionDigits: 2 })}
                </span>
              }
            />
          )}
        </Section>

        {/* Open orders breakdown */}
        <Section icon={<Target className="h-3 w-3" />} title="Open orders">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center justify-between rounded bg-success/10 border border-success/30 px-2 py-1.5">
              <span className="flex items-center gap-1 text-success">
                <ArrowDown className="h-3 w-3" />BUY
              </span>
              <span className="font-mono font-bold tabular-nums">{live.derived.openBuyCount}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-destructive/10 border border-destructive/30 px-2 py-1.5">
              <span className="flex items-center gap-1 text-destructive">
                <ArrowUp className="h-3 w-3" />SELL
              </span>
              <span className="font-mono font-bold tabular-nums">{live.derived.openSellCount}</span>
            </div>
          </div>
        </Section>

        {/* Inventory */}
        {(live.pnl.heldQty > 0 || live.pnl.soldQty > 0) && (
          <Section icon={<Wallet className="h-3 w-3" />} title="Inventory">
            {live.pnl.heldQty > 0 && (
              <Row
                label="Held"
                value={
                  <span className="font-mono">
                    {formatNumber(live.pnl.heldQty, { maximumFractionDigits: 8 })}{' '}
                    <span className="text-muted-foreground">{baseAsset}</span>
                  </span>
                }
              />
            )}
            {live.pnl.soldQty > 0 && (
              <Row
                label="Sold awaiting BB"
                value={
                  <span className="font-mono">
                    {formatNumber(live.pnl.soldQty, { maximumFractionDigits: 8 })}{' '}
                    <span className="text-muted-foreground">{baseAsset}</span>
                  </span>
                }
              />
            )}
          </Section>
        )}

        {/* Break-even (DCA only) */}
        {breakEven !== null && breakEven > 0 && (
          <Section icon={<Target className="h-3 w-3" />} title="Break-even">
            <Row
              label="Avg cost (= break-even)"
              value={
                <span className="font-mono font-semibold">
                  ${formatNumber(breakEven, { maximumFractionDigits: 2 })}
                </span>
              }
            />
            {distanceToBreakEven !== null && market > 0 && (
              <Row
                label="Market vs break-even"
                value={
                  <span className={distanceToBreakEven >= 0 ? 'text-success' : 'text-destructive'}>
                    {distanceToBreakEven >= 0 ? '+' : ''}
                    {distanceToBreakEven.toFixed(3)}%
                  </span>
                }
              />
            )}
          </Section>
        )}

        {/* If nothing held + no breakdown, show a friendly placeholder */}
        {live.pnl.heldQty === 0 && live.pnl.soldQty === 0 && breakEven === null && (
          <div className="text-[11px] text-muted-foreground italic px-1">
            No active position — bot is waiting for fills.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ icon, title, children }: {
  icon?: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        {icon}{title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-right text-foreground font-semibold">
        {value}
      </span>
    </div>
  );
}

