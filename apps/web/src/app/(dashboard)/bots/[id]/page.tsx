'use client';
import { useParams, useRouter } from 'next/navigation';
import { useBot, useBotEvents, useBotOrders, useRecomputeBotStats, useStartBot, useStopBot } from '@/lib/queries';
import { useBotRealtime } from '@/lib/realtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { formatNumber, formatRelativeTime } from '@/lib/utils';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function BotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useBotRealtime(id);
  const { data: bot } = useBot(id);
  const { data: events } = useBotEvents(id);
  const { data: orders } = useBotOrders(id);
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
        <Stat label="Total Trades" value={String(bot.totalTrades ?? 0)} />
        <Stat label="Realized P&L" value={formatNumber(bot.realizedPnlQuote)} sub={bot.quoteAsset} />
        <Stat label="Volume" value="—" />
        <Stat label="Started" value={bot.startedAt ? formatRelativeTime(bot.startedAt) : '—'} />
      </div>

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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-6">
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </CardContent></Card>
  );
}
