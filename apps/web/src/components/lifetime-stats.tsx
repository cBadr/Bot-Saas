'use client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';
import { Trophy, Repeat, TrendingUp, Coins } from 'lucide-react';

/**
 * Lifetime aggregate stats — totals across every run of this bot. Updated
 * atomically by the engine when each run closes.
 */
export function LifetimeStats({ live, quoteAsset }: { live: BotLive; quoteAsset: string }) {
  const lt = live.lifetime;
  const currentRealized = live.pnl.realized;
  const liveDelta = currentRealized;  // current run's realized adds on top of lifetime

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4" />
          Lifetime
          <Badge variant="outline" className="text-[10px]">
            {lt.totalRuns} run{lt.totalRuns === 1 ? '' : 's'}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Aggregated totals across every Start→Stop session of this bot.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4">
        <Tile
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Lifetime realized"
          value={`${lt.realized >= 0 ? '+' : ''}${formatNumber(lt.realized, { maximumFractionDigits: 2 })}`}
          sub={quoteAsset}
          tone={lt.realized >= 0 ? 'positive' : 'negative'}
        />
        <Tile
          icon={<Repeat className="h-3.5 w-3.5" />}
          label="Lifetime cycles"
          value={formatNumber(lt.cycles)}
          sub={lt.cycles > 0 && lt.realized !== 0
            ? `avg ${(lt.realized / lt.cycles).toFixed(4)}/cycle`
            : ''}
        />
        <Tile
          icon={<Coins className="h-3.5 w-3.5" />}
          label="Lifetime volume"
          value={formatNumber(lt.volume, { maximumFractionDigits: 0 })}
          sub={quoteAsset}
        />
        <Tile
          icon={<Coins className="h-3.5 w-3.5" />}
          label="Lifetime fees"
          value={formatNumber(lt.fees, { maximumFractionDigits: 6 })}
          sub={lt.fees > 0 && lt.realized !== 0
            ? `${((lt.fees / Math.abs(lt.realized)) * 100).toFixed(2)}% of realized`
            : ''}
        />

        {live.currentRunId && (
          <div className="md:col-span-4 mt-1 rounded-md border bg-primary/5 px-3 py-2 text-xs flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span>
              <strong>Current run is live</strong> — its
              <span className={`font-mono mx-1 ${liveDelta >= 0 ? 'text-success' : 'text-destructive'}`}>
                {liveDelta >= 0 ? '+' : ''}{formatNumber(liveDelta, { maximumFractionDigits: 4 })} {quoteAsset}
              </span>
              realized will be added to Lifetime when this run stops.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  tone?: 'positive' | 'negative';
}) {
  const cls = tone === 'positive' ? 'text-success'
    : tone === 'negative' ? 'text-destructive' : '';
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`text-xl font-bold tabular-nums mt-1 ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
