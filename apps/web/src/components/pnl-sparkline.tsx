'use client';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Three-tier P&L card per project spec:
 *
 *   Realized  = Σ (sell − buy) × qty over closed BUY↔SELL cycles
 *   Unrealized = (currentPrice − initialStartPrice) × heldQty   ← floating
 *   Total      = Realized + Unrealized
 *
 * The sparkline charts cumulative REALIZED over time (snapshot per closed cycle).
 */
export function PnLSparkline({ live }: { live: BotLive }) {
  const { pnl } = live;
  const totalPositive = pnl.total >= 0;
  const realizedPositive = pnl.realized >= 0;
  const unrealizedPositive = pnl.unrealized >= 0;
  const quoteAsset = live.symbol.endsWith('FDUSD') ? 'FDUSD'
    : live.symbol.endsWith('USDT') ? 'USDT'
    : live.symbol.endsWith('USDC') ? 'USDC'
    : 'quote';

  // Sparkline geometry (cumulative realized series)
  const W = 600;
  const H = 80;
  const padX = 4;
  const padY = 6;
  const innerW = W - 2 * padX;
  const innerH = H - 2 * padY;

  let path = '';
  let area = '';
  if (pnl.series.length >= 2) {
    const min = Math.min(...pnl.series.map((p) => p.pnl), 0);
    const max = Math.max(...pnl.series.map((p) => p.pnl), 0);
    const range = max - min || 1;
    const xFor = (i: number) => padX + (i / (pnl.series.length - 1)) * innerW;
    const yFor = (v: number) => padY + ((max - v) / range) * innerH;

    path = pnl.series
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(2)} ${yFor(p.pnl).toFixed(2)}`)
      .join(' ');
    area = `${path} L ${xFor(pnl.series.length - 1).toFixed(2)} ${yFor(0).toFixed(2)} L ${xFor(0).toFixed(2)} ${yFor(0).toFixed(2)} Z`;
  }

  // Per-hour realized rate
  let perHour = 0;
  if (pnl.series.length >= 2) {
    const first = pnl.series[0]!;
    const last = pnl.series[pnl.series.length - 1]!;
    const hours = Math.max(1 / 60, (last.ts - first.ts) / 3_600_000);
    perHour = pnl.realized / hours;
  }

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {totalPositive ? (
            <TrendingUp className="h-4 w-4 text-success" />
          ) : (
            <TrendingDown className="h-4 w-4 text-destructive" />
          )}
          Profit & Loss
        </CardTitle>
        <CardDescription className="text-xs">
          Realized from closed cycles + floating from held inventory.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total — the headline number */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Total profits</div>
          <div className="flex items-baseline gap-2">
            <div className={`text-4xl font-bold tabular-nums ${totalPositive ? 'text-success' : 'text-destructive'}`}>
              {totalPositive ? '+' : ''}{formatNumber(pnl.total, { maximumFractionDigits: 4 })}
            </div>
            <div className="text-sm text-muted-foreground">{quoteAsset}</div>
          </div>
        </div>

        {/* Realized + Unrealized split */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              <TrendingUp className="h-3 w-3" />Realized
            </div>
            <div className={`text-xl font-semibold font-mono tabular-nums ${realizedPositive ? 'text-success' : 'text-destructive'}`}>
              {realizedPositive ? '+' : ''}{formatNumber(pnl.realized, { maximumFractionDigits: 4 })}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {pnl.cyclesCompleted} cycle{pnl.cyclesCompleted === 1 ? '' : 's'} closed
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              {pnl.unrealized === 0 ? (
                <Minus className="h-3 w-3" />
              ) : unrealizedPositive ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              Unrealized
            </div>
            <div className={`text-xl font-semibold font-mono tabular-nums ${
              pnl.unrealized === 0 ? 'text-muted-foreground' :
              unrealizedPositive ? 'text-success' : 'text-destructive'
            }`}>
              {pnl.unrealized === 0 ? '—'
                : `${unrealizedPositive ? '+' : ''}${formatNumber(pnl.unrealized, { maximumFractionDigits: 4 })}`}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
              {pnl.heldQty > 0
                ? `held ${formatNumber(pnl.heldQty, { maximumFractionDigits: 8 })} base`
                : 'no inventory'}
            </div>
          </div>
        </div>

        {/* Realized sparkline */}
        {pnl.series.length >= 2 ? (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Realized over time
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
              <path d={area} fill={realizedPositive ? 'hsl(var(--success))' : 'hsl(var(--destructive))'} fillOpacity={0.12} />
              <path d={path} fill="none"
                stroke={realizedPositive ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
                strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ) : (
          <div className="h-20 flex items-center justify-center text-xs text-muted-foreground border border-dashed rounded">
            {pnl.series.length === 0 ? 'Waiting for the first closed cycle…' : 'Need at least 2 cycles to chart.'}
          </div>
        )}

        {/* Cycle stats */}
        <div className="grid grid-cols-3 gap-3 pt-2 border-t">
          <Stat label="Cycles" value={String(pnl.cyclesCompleted)} />
          <Stat
            label="Avg / cycle"
            value={pnl.cyclesCompleted > 0 ? formatNumber(pnl.avgPerCycle, { maximumFractionDigits: 4 }) : '—'}
          />
          <Stat
            label="Per hour"
            value={pnl.series.length >= 2 ? formatNumber(perHour, { maximumFractionDigits: 2 }) : '—'}
          />
        </div>

        {/* Inventory exposure */}
        {(pnl.heldQty > 0 || pnl.soldQty > 0) && (
          <div className="text-[11px] text-muted-foreground bg-muted/40 rounded px-3 py-2 space-y-1">
            <div>
              {pnl.heldQty > 0 && (
                <span><span className="font-semibold text-foreground">{formatNumber(pnl.heldQty, { maximumFractionDigits: 8 })}</span> held</span>
              )}
              {pnl.heldQty > 0 && pnl.soldQty > 0 && <span> · </span>}
              {pnl.soldQty > 0 && (
                <span><span className="font-semibold text-foreground">{formatNumber(pnl.soldQty, { maximumFractionDigits: 8 })}</span> sold awaiting BB</span>
              )}
            </div>
            {live.initialStartPrice && live.marketPrice && (
              <div className="font-mono text-[10px]">
                ref start: {formatNumber(live.initialStartPrice, { maximumFractionDigits: 2 })}
                {' · '}
                market: {formatNumber(live.marketPrice, { maximumFractionDigits: 2 })}
                {' · '}
                Δ: {(Number(live.marketPrice) - Number(live.initialStartPrice) >= 0 ? '+' : '')}
                {formatNumber(Number(live.marketPrice) - Number(live.initialStartPrice), { maximumFractionDigits: 2 })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</div>
      <div className="text-base font-semibold font-mono tabular-nums">{value}</div>
    </div>
  );
}
