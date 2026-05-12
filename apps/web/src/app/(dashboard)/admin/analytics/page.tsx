'use client';
import { useChurnAnalytics, useFleetHeatmap, useSymbolWatchlist } from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';
import { Grid3x3, TrendingDown, AlertTriangle, Activity } from 'lucide-react';

export default function AdminAnalyticsPage() {
  const { data: churn } = useChurnAnalytics();
  const { data: heatmap } = useFleetHeatmap();
  const { data: watchlist } = useSymbolWatchlist();

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Churn, fleet distribution, and concentration risk.</p>

      {/* Symbol watchlist + concentration */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Symbol watchlist
            <Badge variant="outline" className="text-[10px]">{watchlist?.length ?? 0} symbols</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Spot symbols that account for too much of the fleet (concentration risk).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Symbol</th>
                <th className="text-right px-3 py-2">Bots</th>
                <th className="text-left px-3 py-2 w-[180px]">Concentration</th>
                <th className="text-right px-3 py-2">Total PnL</th>
                <th className="text-right px-3 py-2">Volume</th>
                <th className="text-right px-3 py-2">Trades</th>
              </tr>
            </thead>
            <tbody>
              {watchlist?.slice(0, 30).map((w) => (
                <tr key={w.symbol} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono font-medium">{w.symbol}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{w.bots}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full ${
                          w.concentrationPct >= 50 ? 'bg-destructive'
                          : w.concentrationPct >= 25 ? 'bg-amber-500'
                          : 'bg-primary'
                        }`} style={{ width: `${Math.min(100, w.concentrationPct)}%` }} />
                      </div>
                      <span className={`text-[10px] font-mono tabular-nums w-12 text-right ${
                        w.concentrationPct >= 50 ? 'text-destructive' : ''
                      }`}>
                        {w.concentrationPct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${w.realizedPnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {w.realizedPnl >= 0 ? '+' : ''}{formatNumber(w.realizedPnl, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-xs">
                    {formatNumber(w.volume, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-xs">{w.trades}</td>
                </tr>
              ))}
              {!watchlist?.length && (
                <tr><td colSpan={6} className="text-center py-8 text-sm text-muted-foreground italic">No data.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Fleet heatmap */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Grid3x3 className="h-4 w-4" /> Fleet heatmap · Strategy × Symbol
          </CardTitle>
          <CardDescription className="text-xs">
            {heatmap ? `${heatmap.total} bots · ${heatmap.strategies.length} strategies · ${heatmap.symbols.length} symbols` : '—'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-3 overflow-x-auto">
          {heatmap && heatmap.strategies.length > 0 ? (
            <FleetHeatmapTable data={heatmap} />
          ) : (
            <p className="text-xs italic text-muted-foreground">No bots yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Churn analytics */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="h-4 w-4" /> Churn by plan · 180d
            </CardTitle>
            <CardDescription className="text-xs">Subscriptions created in the last 180 days, grouped by plan.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Plan</th>
                  <th className="text-right px-3 py-2">Active</th>
                  <th className="text-right px-3 py-2">Trial</th>
                  <th className="text-right px-3 py-2">Canceled</th>
                  <th className="text-right px-3 py-2">Churn %</th>
                </tr>
              </thead>
              <tbody>
                {churn?.perPlan.map((p) => (
                  <tr key={p.code} className="border-b last:border-0">
                    <td className="px-3 py-1.5">{p.name} <Badge variant="outline" className="text-[9px] font-mono ml-1">{p.code}</Badge></td>
                    <td className="text-right px-3 py-1.5 font-mono tabular-nums">{p.active}</td>
                    <td className="text-right px-3 py-1.5 font-mono tabular-nums text-amber-600">{p.trial}</td>
                    <td className="text-right px-3 py-1.5 font-mono tabular-nums text-destructive">{p.canceled}</td>
                    <td className={`text-right px-3 py-1.5 font-mono tabular-nums ${
                      p.churnRate > 20 ? 'text-destructive' : p.churnRate > 10 ? 'text-amber-600' : 'text-success'
                    }`}>{p.churnRate.toFixed(1)}%</td>
                  </tr>
                ))}
                {!churn?.perPlan.length && (
                  <tr><td colSpan={5} className="text-center py-8 text-sm text-muted-foreground italic">No data.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Cohort retention · monthly
            </CardTitle>
            <CardDescription className="text-xs">Subs signing up each month vs how many canceled.</CardDescription>
          </CardHeader>
          <CardContent>
            {churn?.cohorts.length ? <CohortBars data={churn.cohorts} /> : (
              <p className="text-xs italic text-muted-foreground">No data.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FleetHeatmapTable({ data }: {
  data: {
    strategies: string[];
    symbols: string[];
    cells: Record<string, Record<string, number>>;
    total: number;
  };
}) {
  // Find max for color intensity.
  let max = 1;
  for (const s of data.strategies) {
    for (const sym of data.symbols) {
      const v = data.cells[s]?.[sym] ?? 0;
      if (v > max) max = v;
    }
  }
  return (
    <table className="text-xs">
      <thead>
        <tr>
          <th className="text-left px-2 py-1 font-medium text-muted-foreground">strategy ↓ / symbol →</th>
          {data.symbols.map((s) => (
            <th key={s} className="px-1 py-1 font-mono text-[10px] text-muted-foreground"
              style={{ writingMode: 'vertical-rl', height: 60 }}>
              {s}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.strategies.map((strat) => (
          <tr key={strat}>
            <td className="px-2 py-1 font-mono whitespace-nowrap">{strat}</td>
            {data.symbols.map((sym) => {
              const v = data.cells[strat]?.[sym] ?? 0;
              const intensity = v === 0 ? 0 : Math.max(0.15, v / max);
              return (
                <td key={sym}
                  title={`${strat} × ${sym}: ${v} bot${v === 1 ? '' : 's'}`}
                  className="text-center font-mono tabular-nums"
                  style={{
                    backgroundColor: v > 0 ? `hsl(220 70% 50% / ${intensity})` : undefined,
                    color: v > 0 && intensity > 0.6 ? 'white' : undefined,
                    padding: '4px 6px',
                    minWidth: 28,
                  }}>
                  {v || ''}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CohortBars({ data }: { data: Array<{ month: string; total: number; canceled: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div className="space-y-1.5">
      {data.map((c) => (
        <div key={c.month}>
          <div className="flex items-center justify-between text-[11px] mb-0.5">
            <span className="font-mono">{c.month}</span>
            <span className="font-mono tabular-nums">
              {c.total - c.canceled}/{c.total} retained
              <span className="text-muted-foreground ml-1">
                ({c.total > 0 ? (((c.total - c.canceled) / c.total) * 100).toFixed(0) : 0}%)
              </span>
            </span>
          </div>
          <div className="h-3 rounded-sm bg-muted overflow-hidden relative">
            <div className="h-full bg-success/70" style={{ width: `${((c.total - c.canceled) / max) * 100}%` }} />
            <div className="h-full bg-destructive/70 absolute top-0"
              style={{
                left: `${((c.total - c.canceled) / max) * 100}%`,
                width: `${(c.canceled / max) * 100}%`,
              }} />
          </div>
        </div>
      ))}
    </div>
  );
}
