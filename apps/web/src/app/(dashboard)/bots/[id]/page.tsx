'use client';
import { useParams, useRouter } from 'next/navigation';
import { useBot, useBotEvents, useBotLive, useBotOrders, useRecomputeBotStats, useStartBot, useStopBot } from '@/lib/queries';
import { useBotRealtime } from '@/lib/realtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { LiveTradingChart } from '@/components/live-trading-chart';
import { IntegrityWidget } from '@/components/integrity-widget';
import { PnLSparkline } from '@/components/pnl-sparkline';
import { BotConfigCard } from '@/components/bot-config-card';
import { PositionStateCard } from '@/components/position-state-card';
import { PerformanceCard } from '@/components/performance-card';
import { formatDuration, formatNumber, formatRelativeTime } from '@/lib/utils';
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';

export default function BotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useBotRealtime(id);
  const { data: bot } = useBot(id);
  const { data: events } = useBotEvents(id);
  const { data: orders } = useBotOrders(id);
  const { data: live } = useBotLive(id);
  const start = useStartBot();
  const stop = useStopBot();
  const recompute = useRecomputeBotStats();

  if (!bot) return <div className="text-muted-foreground">Loading bot…</div>;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold truncate">{bot.name}</h1>
            <StatusBadge status={bot.status} />
            {bot.paperTrading && (
              <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-700 dark:text-yellow-400">
                paper
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap mt-1">
            <Badge variant="outline" className="font-mono text-[10px]">{bot.symbol}</Badge>
            <span>·</span>
            <span>{bot.strategy?.name ?? '—'}</span>
            {live?.config.direction && (
              <>
                <span>·</span>
                <Badge
                  variant={live.config.direction === 'BUY' ? 'success' : 'destructive'}
                  className="text-[10px] font-mono"
                >
                  {live.config.direction}
                </Badge>
              </>
            )}
            {bot.startedAt && (
              <>
                <span>·</span>
                <span className="font-mono text-xs">running {formatDuration(bot.startedAt)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" disabled={recompute.isPending}
            onClick={() => recompute.mutate(bot.id, { onSuccess: () => toast.success('Stats refreshed'), onError: (e) => toast.error(e.message) })}
            title="Recompute stats from trade history">
            <RefreshCw className={`h-4 w-4 ${recompute.isPending ? 'animate-spin' : ''}`} />
          </Button>
          {bot.status === 'RUNNING' || bot.status === 'STARTING' ? (
            <Button variant="outline" onClick={() => stop.mutate(bot.id, { onSuccess: () => toast.success('Stopping') })}>Stop</Button>
          ) : (
            <Button variant="success" onClick={() => start.mutate(bot.id, { onSuccess: () => toast.success('Starting'), onError: (e) => toast.error(e.message) })}>Start</Button>
          )}
        </div>
      </div>

      {/* ─── 4 KPI Tiles: Total / Realized / Floating / Volume ─── */}
      <div className="grid gap-4 md:grid-cols-4">
        <KpiTile
          icon={live && live.pnl.total >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          label="Total Profits"
          value={live ? signed(live.pnl.total) : '—'}
          sub={bot.quoteAsset}
          tone={kpiTone(live?.pnl.total)}
          big
        />
        <KpiTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Realized P&L"
          value={live ? signed(live.pnl.realized) : '—'}
          sub={live ? `${live.pnl.cyclesCompleted} cycle${live.pnl.cyclesCompleted === 1 ? '' : 's'}` : bot.quoteAsset}
          tone={kpiTone(live?.pnl.realized)}
        />
        <KpiTile
          icon={live && live.pnl.unrealized >= 0
            ? <TrendingUp className="h-4 w-4" />
            : <TrendingDown className="h-4 w-4" />}
          label="Floating P&L"
          value={live && live.pnl.unrealized !== 0 ? signed(live.pnl.unrealized) : '—'}
          sub={bot.quoteAsset}
          tone={kpiTone(live?.pnl.unrealized)}
        />
        <KpiTile
          icon={<RefreshCw className="h-4 w-4" />}
          label="Total Volume"
          value={live ? formatNumber(live.volume.totalQuote, { maximumFractionDigits: 2 }) : '—'}
          sub={live && live.volume.tradeCount > 0
            ? `${live.volume.tradeCount} trade${live.volume.tradeCount === 1 ? '' : 's'}`
            : bot.quoteAsset}
        />
      </div>

      {/* ─── Live monitoring (Grid Simple + DCA Simple) ─── */}
      {live && (live.initialStartPrice || live.integrity.total > 0 || live.pnl.cyclesCompleted > 0 || live.cooldown) && (
        <>
          {/* Live trading chart — full width */}
          <LiveTradingChart live={live} />

          {/* 3-card row: Configuration / Position State / Performance */}
          <div className="grid gap-6 lg:grid-cols-3">
            <BotConfigCard
              builtinKey={bot.strategy?.builtinKey ?? null}
              params={bot.params}
              paperTrading={bot.paperTrading}
              quoteAsset={bot.quoteAsset}
            />
            <PositionStateCard
              live={live}
              baseAsset={deriveBaseAsset(live.symbol, bot.quoteAsset)}
            />
            <PerformanceCard
              live={live}
              quoteAsset={bot.quoteAsset}
            />
          </div>

          {/* 2-card row: Integrity / PnL chart */}
          <div className="grid gap-6 md:grid-cols-2">
            <IntegrityWidget live={live} />
            <PnLSparkline live={live} />
          </div>
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent Events</CardTitle></CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto">
            {!events?.length ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <div className="space-y-2">
                {events.map((e) => (
                  <div key={e.id} className="text-sm border-l-2 border-primary/40 pl-3 py-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{e.type}</Badge>
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(e.createdAt)}</span>
                    </div>
                    <p className="mt-0.5">{e.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent Orders</CardTitle></CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto">
            {!orders?.length ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between text-sm border-b py-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={o.side === 'BUY' ? 'success' : 'destructive'} className="text-[10px]">{o.side}</Badge>
                      <span className="font-mono">{formatNumber(o.quantity)} @ {formatNumber(o.price)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                      <span>{formatRelativeTime(o.placedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function deriveBaseAsset(symbol: string, quoteAsset?: string | null): string {
  if (quoteAsset && symbol.endsWith(quoteAsset)) return symbol.slice(0, -quoteAsset.length);
  for (const q of ['FDUSD', 'USDT', 'USDC', 'BUSD', 'BTC', 'ETH']) {
    if (symbol.endsWith(q)) return symbol.slice(0, -q.length);
  }
  return symbol;
}

function signed(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = formatNumber(n, { maximumFractionDigits: 4 });
  return n > 0 ? `+${abs}` : `${abs}`;
}

function kpiTone(n: number | undefined): 'positive' | 'negative' | undefined {
  if (n === undefined || n === 0) return undefined;
  return n > 0 ? 'positive' : 'negative';
}

function KpiTile({
  icon, label, value, sub, tone, big,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'negative';
  big?: boolean;
}) {
  const toneClass = tone === 'positive' ? 'text-success'
    : tone === 'negative' ? 'text-destructive'
    : '';
  return (
    <Card className={big ? 'border-2 border-primary/20' : undefined}>
      <CardContent className="p-5">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
          {icon}<span>{label}</span>
        </div>
        <div className={`font-bold tabular-nums ${toneClass} ${big ? 'text-3xl' : 'text-2xl'}`}>
          {value}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
