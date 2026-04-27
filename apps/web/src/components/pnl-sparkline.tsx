'use client';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

export function PnLSparkline({ live }: { live: BotLive }) {
  const { pnl } = live;
  const positive = pnl.cumulative >= 0;

  // Sparkline geometry
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

    path = pnl.series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(2)} ${yFor(p.pnl).toFixed(2)}`).join(' ');
    const last = pnl.series[pnl.series.length - 1]!;
    const first = pnl.series[0]!;
    area = `${path} L ${xFor(pnl.series.length - 1).toFixed(2)} ${yFor(0).toFixed(2)} L ${xFor(0).toFixed(2)} ${yFor(0).toFixed(2)} Z`;
    void first; void last;
  }

  // Per-hour rate from series span
  let perHour = 0;
  if (pnl.series.length >= 2) {
    const first = pnl.series[0]!;
    const last = pnl.series[pnl.series.length - 1]!;
    const hours = Math.max(1 / 60, (last.ts - first.ts) / 3_600_000);
    perHour = pnl.cumulative / hours;
  }

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {positive ? (
            <TrendingUp className="h-4 w-4 text-success" />
          ) : (
            <TrendingDown className="h-4 w-4 text-destructive" />
          )}
          Realized P&L
        </CardTitle>
        <CardDescription className="text-xs">
          Cumulative realized profit from completed BUY→SELL round-trips.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Headline */}
        <div className="flex items-baseline gap-3">
          <div className={`text-4xl font-bold tabular-nums ${positive ? 'text-success' : 'text-destructive'}`}>
            {positive ? '+' : ''}{formatNumber(pnl.cumulative, { maximumFractionDigits: 4 })}
          </div>
          <div className="text-sm text-muted-foreground">{live.symbol.replace(/^[A-Z]{3,5}/, '') || 'quote'}</div>
        </div>

        {/* Sparkline */}
        {pnl.series.length >= 2 ? (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
            <path d={area} fill={positive ? 'hsl(var(--success))' : 'hsl(var(--destructive))'} fillOpacity={0.12} />
            <path d={path} fill="none"
              stroke={positive ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
              strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <div className="h-20 flex items-center justify-center text-xs text-muted-foreground border border-dashed rounded">
            {pnl.series.length === 0
              ? 'Waiting for the first completed cycle…'
              : 'Need at least 2 cycles to chart.'}
          </div>
        )}

        {/* Stats grid */}
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

        {pnl.unmatchedBuys > 0 && (
          <div className="text-[11px] text-muted-foreground bg-muted/40 rounded px-3 py-2">
            <span className="font-semibold text-foreground">{pnl.unmatchedBuys}</span> unmatched BUY
            {pnl.unmatchedBuys > 1 ? 's' : ''} held — counter SELLs are open above.
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
