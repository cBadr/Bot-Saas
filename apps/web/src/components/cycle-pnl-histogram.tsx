'use client';
import { BarChart2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Histogram of per-cycle realized PnL — distribution shape reveals whether
 * the bot earns from many tiny cycles (tight cluster) or rare big ones
 * (long tail). Derived client-side from `pnl.series` (cumulative) by
 * differencing consecutive points.
 */
export function CyclePnLHistogram({ live }: { live: BotLive }) {
  const series = live.pnl.series ?? [];
  if (series.length < 2) {
    return (
      <Card className="shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-primary" />
            Cycle PnL Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">Need ≥ 2 closed cycles to plot a distribution.</p>
        </CardContent>
      </Card>
    );
  }

  // Diff cumulative into per-cycle PnL.
  const perCycle: number[] = [];
  for (let i = 1; i < series.length; i++) {
    perCycle.push(series[i].pnl - series[i - 1].pnl);
  }
  // First entry: assume started from 0.
  perCycle.unshift(series[0].pnl);

  const min = Math.min(...perCycle);
  const max = Math.max(...perCycle);
  const bins = 20;
  const span = Math.max(max - min, 1e-9);
  const binW = span / bins;
  const counts = new Array(bins).fill(0);
  for (const v of perCycle) {
    let idx = Math.floor((v - min) / binW);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-primary" />
          Cycle PnL Distribution
        </CardTitle>
        <CardDescription className="text-xs">
          {perCycle.length} cycles · min {formatNumber(min, { maximumFractionDigits: 4 })} · max {formatNumber(max, { maximumFractionDigits: 4 })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-px h-[120px]">
          {counts.map((c, i) => {
            const binStart = min + i * binW;
            const isPositive = binStart >= 0;
            const h = maxCount > 0 ? (c / maxCount) * 100 : 0;
            return (
              <div key={i}
                title={`${formatNumber(binStart, { maximumFractionDigits: 4 })} — ${formatNumber(binStart + binW, { maximumFractionDigits: 4 })}: ${c}`}
                className={`flex-1 ${isPositive ? 'bg-success/70' : 'bg-destructive/70'} hover:opacity-80`}
                style={{ height: `${h}%`, minHeight: c > 0 ? '2px' : '0' }}
              />
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1">
          <span>{formatNumber(min, { maximumFractionDigits: 4 })}</span>
          <span className="text-foreground">0</span>
          <span>{formatNumber(max, { maximumFractionDigits: 4 })}</span>
        </div>
      </CardContent>
    </Card>
  );
}
