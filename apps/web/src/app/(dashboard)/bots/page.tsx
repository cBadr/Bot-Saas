'use client';
import Link from 'next/link';
import { AlertOctagon, Plus, RefreshCw } from 'lucide-react';
import { useBots, useDeleteBot, useEmergencyStopAll, useRecomputeBotStats, useStartBot, useStopBot } from '@/lib/queries';
import { useUserBotsRealtime } from '@/lib/realtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { formatNumber, formatRelativeTime } from '@/lib/utils';
import { toast } from 'sonner';

export default function BotsPage() {
  useUserBotsRealtime();
  const { data: bots, isLoading } = useBots();
  const start = useStartBot();
  const stop = useStopBot();
  const del = useDeleteBot();
  const recompute = useRecomputeBotStats();
  const killAll = useEmergencyStopAll();
  const runningCount = bots?.filter((b) => b.status === 'RUNNING' || b.status === 'STARTING').length ?? 0;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Bots</h1>
          <p className="text-muted-foreground">Manage your automated trading bots.</p>
        </div>
        <div className="flex items-center gap-2">
          {runningCount > 0 && (
            <Button variant="destructive" disabled={killAll.isPending}
              onClick={() => {
                if (!confirm(`🛑 Emergency stop ALL ${runningCount} running bots and cancel their open orders?`)) return;
                killAll.mutate(undefined, {
                  onSuccess: (r) => toast.success(`Stopped ${r.stopped} bots`),
                  onError: (e) => toast.error(e.message),
                });
              }}>
              <AlertOctagon className="h-4 w-4" />Kill Switch ({runningCount})
            </Button>
          )}
          <Button variant="outline" disabled={recompute.isPending} onClick={() => recompute.mutate(undefined, {
            onSuccess: (r) => toast.success(`Recomputed stats for ${(r as { updated: number }).updated} bots`),
            onError: (e) => toast.error(e.message),
          })}>
            <RefreshCw className={`h-4 w-4 ${recompute.isPending ? 'animate-spin' : ''}`} />Recompute Stats
          </Button>
          <Button asChild><Link href="/bots/new"><Plus className="h-4 w-4" />New Bot</Link></Button>
        </div>
      </div>

      {isLoading ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">Loading...</CardContent></Card>
      ) : !bots?.length ? (
        <Card><CardContent className="p-12 text-center">
          <p className="text-muted-foreground mb-4">No bots yet.</p>
          <Button asChild><Link href="/bots/new">Create your first bot</Link></Button>
        </CardContent></Card>
      ) : (
        <div className="grid gap-4">
          {bots.map((b) => (
            <Card key={b.id}>
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <Link href={`/bots/${b.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold truncate">{b.name}</h3>
                    <StatusBadge status={b.status} />
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="font-mono">{b.symbol}</span>
                    <span>·</span>
                    <span>{b.strategy?.name}</span>
                    <span>·</span>
                    <span>{b.totalTrades} trades</span>
                    <span>·</span>
                    <span>P&L: {formatNumber(b.realizedPnlQuote)}</span>
                    {b.startedAt && (
                      <>
                        <span>·</span>
                        <span>started {formatRelativeTime(b.startedAt)}</span>
                      </>
                    )}
                  </div>
                </Link>
                <div className="flex items-center gap-2">
                  {b.status === 'RUNNING' || b.status === 'STARTING' ? (
                    <Button variant="outline" size="sm" disabled={stop.isPending}
                      onClick={() => stop.mutate(b.id, { onSuccess: () => toast.success('Stopping…') })}>
                      Stop
                    </Button>
                  ) : (
                    <Button variant="success" size="sm" disabled={start.isPending}
                      onClick={() => start.mutate(b.id, {
                        onSuccess: () => toast.success('Starting…'),
                        onError: (e) => toast.error(e.message),
                      })}>
                      Start
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" disabled={del.isPending}
                    onClick={() => {
                      if (!confirm(`Delete bot "${b.name}"?`)) return;
                      del.mutate(b.id, {
                        onSuccess: () => toast.success('Deleted'),
                        onError: (e) => toast.error(e.message),
                      });
                    }}>
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
