'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useBot, useBotLive, useBotOrders, useRecomputeBotStats, useStartBot, useStopBot } from '@/lib/queries';
import { useBotRealtime } from '@/lib/realtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { LiveTradingChart } from '@/components/live-trading-chart';
import { BotConfigCard } from '@/components/bot-config-card';
import { PerformanceCard } from '@/components/performance-card';
import { PositionBreakdownCard } from '@/components/position-breakdown-card';
import { EventsTimeline } from '@/components/events-timeline';
import { GridLevelsViz } from '@/components/grid-levels-viz';
import { CyclePnLHistogram } from '@/components/cycle-pnl-histogram';
import { QuickActionsBar } from '@/components/quick-actions-bar';
import { WhatIfSimulator } from '@/components/what-if-simulator';
import { EquityCurve } from '@/components/equity-curve';
import { MarketPriceBanner } from '@/components/market-price-banner';
import { OrdersHealthCard } from '@/components/orders-health';
import { RunsHistory } from '@/components/runs-history';
import { LifetimeStats } from '@/components/lifetime-stats';
import { formatDuration, formatNumber } from '@/lib/utils';
import {
  ArrowLeft, RefreshCw, TrendingUp, TrendingDown,
  LayoutDashboard, Wallet, BarChart3, ListChecks, Activity, Settings, History,
} from 'lucide-react';
import { toast } from 'sonner';

type Tab = 'overview' | 'position' | 'performance' | 'orders' | 'activity' | 'history' | 'config';

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview',    label: 'Overview',    icon: LayoutDashboard },
  { key: 'position',    label: 'Position',    icon: Wallet },
  { key: 'performance', label: 'Performance', icon: BarChart3 },
  { key: 'orders',      label: 'Orders',      icon: ListChecks },
  { key: 'activity',    label: 'Activity',    icon: Activity },
  { key: 'history',     label: 'History',     icon: History },
  { key: 'config',      label: 'Config',      icon: Settings },
];

export default function BotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useBotRealtime(id);
  const { data: bot } = useBot(id);
  const { data: orders } = useBotOrders(id);
  const { data: live } = useBotLive(id);
  const start = useStartBot();
  const stop = useStopBot();
  const recompute = useRecomputeBotStats();
  const [tab, setTab] = useState<Tab>('overview');

  if (!bot) return <div className="text-muted-foreground">Loading bot…</div>;
  const baseAsset = deriveBaseAsset(bot.symbol, bot.quoteAsset);

  // Archive nudge: bot stopped > 30 days, has run history, and not yet archived.
  const idleDaysMs = bot.stoppedAt ? Date.now() - new Date(bot.stoppedAt).getTime() : 0;
  const showArchiveNudge = !bot.archivedAt
    && bot.status === 'STOPPED'
    && (live?.lifetime.totalRuns ?? 0) > 0
    && idleDaysMs > 30 * 86_400_000;

  return (
    <div className="space-y-5 max-w-7xl">
      {/* ─── Slim header ─── */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{bot.name}</h1>
            <StatusBadge status={bot.status} />
            {bot.paperTrading && (
              <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-700 dark:text-yellow-400">
                paper
              </Badge>
            )}
            {live?.heartbeat && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto">
                <span className={`h-2 w-2 rounded-full ${live.heartbeat.stale ? 'bg-destructive' : 'bg-success animate-pulse'}`} />
                {live.heartbeat.stale ? 'engine idle' : 'engine live'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap mt-1">
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
                <span className="font-mono">running {formatDuration(bot.startedAt)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="icon" disabled={recompute.isPending}
            onClick={() => recompute.mutate(bot.id, { onSuccess: () => toast.success('Stats refreshed'), onError: (e) => toast.error(e.message) })}
            title="Recompute stats from trade history">
            <RefreshCw className={`h-4 w-4 ${recompute.isPending ? 'animate-spin' : ''}`} />
          </Button>
          {bot.status === 'RUNNING' || bot.status === 'STARTING' ? (
            <Button variant="outline" size="sm" onClick={() => stop.mutate(bot.id, { onSuccess: () => toast.success('Stopping') })}>Stop</Button>
          ) : (
            <Button variant="success" size="sm" onClick={() => start.mutate(bot.id, { onSuccess: () => toast.success('Starting'), onError: (e) => toast.error(e.message) })}>Start</Button>
          )}
        </div>
      </div>

      {/* Archive nudge for long-idle bots */}
      {showArchiveNudge && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 flex items-center gap-2 text-xs">
          <span>This bot has been idle for over {Math.floor(idleDaysMs / 86_400_000)} days. Consider archiving to keep your active list clean — data is preserved.</span>
        </div>
      )}

      {/* ─── Market price banner (the page anchor) ─── */}
      {live && <MarketPriceBanner live={live} baseAsset={baseAsset} quoteAsset={bot.quoteAsset} />}

      {/* ─── Compact KPI strip (no duplication with banner) ─── */}
      {live && (
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi label="Total P&L" value={signed(live.pnl.total)} sub={bot.quoteAsset} tone={kpiTone(live.pnl.total)} big />
          <Kpi label="Realized"
               value={signed(live.pnl.realized)}
               sub={`${live.pnl.cyclesCompleted} cycle${live.pnl.cyclesCompleted === 1 ? '' : 's'}`}
               tone={kpiTone(live.pnl.realized)} />
          <Kpi label="Floating"
               value={live.pnl.unrealized !== 0 ? signed(live.pnl.unrealized) : '—'}
               sub={bot.quoteAsset}
               tone={kpiTone(live.pnl.unrealized)} />
          <Kpi label="ROI"
               value={live.pnl.roi !== null ? `${live.pnl.roi >= 0 ? '+' : ''}${live.pnl.roi.toFixed(2)}%` : '—'}
               sub={`vol ${formatNumber(live.volume.totalQuote, { maximumFractionDigits: 0 })}`}
               tone={live.pnl.roi !== null ? (live.pnl.roi >= 0 ? 'positive' : 'negative') : undefined} />
        </div>
      )}

      {/* ─── Tabs ─── */}
      <div className="flex items-center gap-1 border-b overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}>
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
        <div className="ml-auto">
          <QuickActionsBar botId={bot.id} botName={bot.name} />
        </div>
      </div>

      {/* ─── Tab content ─── */}
      {live && (
        <>
          {tab === 'overview' && (
            <div className="space-y-5">
              <LiveTradingChart live={live} />
              <LifetimeStats live={live} quoteAsset={bot.quoteAsset} />
              <div className="grid gap-5 lg:grid-cols-2">
                <OrdersHealthCard live={live} />
                <EquityCurve live={live} />
              </div>
            </div>
          )}

          {tab === 'position' && (
            <div className="space-y-5">
              <PositionBreakdownCard live={live} baseAsset={baseAsset} quoteAsset={bot.quoteAsset} />
              <WhatIfSimulator live={live} quoteAsset={bot.quoteAsset} />
            </div>
          )}

          {tab === 'performance' && (
            <div className="space-y-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <PerformanceCard live={live} quoteAsset={bot.quoteAsset} />
                <EquityCurve live={live} />
              </div>
              <CyclePnLHistogram live={live} />
            </div>
          )}

          {tab === 'orders' && (
            <div className="space-y-5">
              <OrdersHealthCard live={live} />
              <GridLevelsViz live={live} />
              <Card>
                <CardHeader><CardTitle className="text-base">Recent orders (history)</CardTitle></CardHeader>
                <CardContent className="max-h-[400px] overflow-y-auto">
                  {!orders?.length ? (
                    <p className="text-sm text-muted-foreground italic">No orders yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {orders.map((o) => (
                        <div key={o.id} className="flex items-center justify-between text-xs border-b last:border-0 py-1.5">
                          <div className="flex items-center gap-2">
                            <Badge variant={o.side === 'BUY' ? 'success' : 'destructive'} className="text-[9px]">{o.side}</Badge>
                            <span className="font-mono">{formatNumber(o.quantity)} @ {formatNumber(o.price)}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Badge variant="outline" className="text-[9px]">{o.status}</Badge>
                            <span className="text-[10px]">{new Date(o.placedAt).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'activity' && <EventsTimeline live={live} />}

          {tab === 'history' && (
            <RunsHistory botId={bot.id} botStatus={bot.status} />
          )}

          {tab === 'config' && (
            <BotConfigCard
              builtinKey={bot.strategy?.builtinKey ?? null}
              params={bot.params}
              paperTrading={bot.paperTrading}
              quoteAsset={bot.quoteAsset}
            />
          )}
        </>
      )}
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

function Kpi({ label, value, sub, tone, big }: {
  label: string; value: string; sub?: string; tone?: 'positive' | 'negative'; big?: boolean;
}) {
  const toneClass = tone === 'positive' ? 'text-success'
    : tone === 'negative' ? 'text-destructive'
    : '';
  return (
    <Card className={big ? 'border-primary/40' : undefined}>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
        <div className={`font-bold tabular-nums ${toneClass} ${big ? 'text-2xl' : 'text-xl'}`}>
          {value}
        </div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}
