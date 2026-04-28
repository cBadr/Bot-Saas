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
import { BotInfoCard } from '@/components/bot-info-card';
import { formatDuration, formatNumber, formatRelativeTime } from '@/lib/utils';
import { ArrowLeft, RefreshCw } from 'lucide-react';
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
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{bot.name}</h1>
            <StatusBadge status={bot.status} />
          </div>
          <p className="text-muted-foreground font-mono text-sm">{bot.symbol} · {bot.strategy?.name}</p>
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

      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          label="Completed Cycles"
          value={String(live?.pnl.cyclesCompleted ?? 0)}
          sub={live && live.pnl.avgPerCycle > 0
            ? `avg ${formatNumber(live.pnl.avgPerCycle, { maximumFractionDigits: 4 })} / cycle`
            : undefined}
        />
        <Stat
          label="Total Profits"
          value={live ? formatNumber(live.pnl.total, { maximumFractionDigits: 4 }) : formatNumber(bot.realizedPnlQuote)}
          sub={bot.quoteAsset}
          tone={live && live.pnl.total !== 0 ? (live.pnl.total > 0 ? 'positive' : 'negative') : undefined}
        />
        <Stat
          label="Volume"
          value={live ? formatNumber(live.volume.totalQuote, { maximumFractionDigits: 2 }) : '—'}
          sub={live && live.volume.tradeCount > 0
            ? `${live.volume.tradeCount} trade${live.volume.tradeCount === 1 ? '' : 's'}`
            : 'FDUSD'}
        />
        <Stat label="Started" value={bot.startedAt ? formatDuration(bot.startedAt) : '—'} />
      </div>

      {/* ─── Live monitoring (only meaningful for grid-style strategies with state) ─── */}
      {live && live.integrity.total > 0 && (
        <>
          <LiveTradingChart live={live} />
          <div className="grid gap-6 lg:grid-cols-3">
            <BotInfoCard
              live={live}
              orderSizeQuote={extractOrderSize(bot)}
              baseAsset={deriveBaseAsset(live.symbol, bot.quoteAsset)}
            />
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

function extractOrderSize(bot: { params?: unknown } | undefined): number | undefined {
  const p = (bot?.params ?? {}) as Record<string, unknown>;
  const v = p.orderSize ?? p.gsOrderSize;
  return typeof v === 'number' ? v : Number(v) || undefined;
}

function deriveBaseAsset(symbol: string, quoteAsset?: string | null): string {
  if (quoteAsset && symbol.endsWith(quoteAsset)) return symbol.slice(0, -quoteAsset.length);
  for (const q of ['FDUSD', 'USDT', 'USDC', 'BUSD', 'BTC', 'ETH']) {
    if (symbol.endsWith(q)) return symbol.slice(0, -q.length);
  }
  return symbol;
}

function Stat({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: 'positive' | 'negative' }) {
  const toneClass = tone === 'positive' ? 'text-success'
    : tone === 'negative' ? 'text-destructive'
    : '';
  return (
    <Card><CardContent className="p-6">
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </CardContent></Card>
  );
}
