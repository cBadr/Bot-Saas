'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  AlertOctagon, Plus, RefreshCw, TrendingUp, TrendingDown, Layers, Coins, Repeat,
  Archive, Trophy, ArchiveRestore,
} from 'lucide-react';
import {
  useBots, useEmergencyStopAll, useRecomputeBotStats, useStartBot, useStopBot,
  useArchiveBot, useUnarchiveBot, type Bot,
} from '@/lib/queries';
import { useUserBotsRealtime } from '@/lib/realtime';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { formatDuration, formatNumber } from '@/lib/utils';
import { toast } from 'sonner';

export default function BotsPage() {
  useUserBotsRealtime();
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: bots, isLoading } = useBots(includeArchived);
  const start = useStartBot();
  const stop = useStopBot();
  const archive = useArchiveBot();
  const unarchive = useUnarchiveBot();
  const recompute = useRecomputeBotStats();
  const killAll = useEmergencyStopAll();
  const runningCount = bots?.filter((b) => b.status === 'RUNNING' || b.status === 'STARTING').length ?? 0;
  const archivedCount = bots?.filter((b) => b.archivedAt).length ?? 0;

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

      {/* Toolbar: archived toggle */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
          {archivedCount > 0 && (
            <Badge variant="outline" className="text-[9px] ml-1">{archivedCount}</Badge>
          )}
        </label>
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
          {bots.map((b) => <BotRow key={b.id} b={b}
            onStart={() => start.mutate(b.id, {
              onSuccess: () => toast.success('Starting…'),
              onError: (e) => toast.error(e.message),
            })}
            onStop={() => stop.mutate(b.id, { onSuccess: () => toast.success('Stopping…') })}
            onArchive={() => {
              if (!confirm(`Archive "${b.name}"? Bot is hidden from the active list; data and runs are preserved.`)) return;
              archive.mutate(b.id, {
                onSuccess: () => toast.success('Archived'),
                onError: (e) => toast.error(e.message),
              });
            }}
            onUnarchive={() => {
              unarchive.mutate(b.id, {
                onSuccess: () => toast.success('Restored'),
                onError: (e) => toast.error(e.message),
              });
            }}
            startPending={start.isPending}
            stopPending={stop.isPending}
            archivePending={archive.isPending || unarchive.isPending}
          />)}
        </div>
      )}
    </div>
  );
}

function BotRow({
  b, onStart, onStop, onArchive, onUnarchive, startPending, stopPending, archivePending,
}: {
  b: Bot;
  onStart: () => void; onStop: () => void;
  onArchive: () => void; onUnarchive: () => void;
  startPending: boolean; stopPending: boolean; archivePending: boolean;
}) {
  const ls = b.liveStats;
  const lt = b.lifetimeStats;
  const isRunning = b.status === 'RUNNING' || b.status === 'STARTING';
  const isArchived = !!b.archivedAt;
  const totalTone = ls && ls.total > 0 ? 'text-success'
    : ls && ls.total < 0 ? 'text-destructive'
    : 'text-muted-foreground';
  const hasRunHistory = (lt?.totalRuns ?? 0) > 0;

  return (
    <Card className={`hover:border-primary/40 transition-colors ${isArchived ? 'opacity-60' : ''}`}>
      <CardContent className="p-5">
        <Link href={`/bots/${b.id}`} className="block">
          {/* Header row */}
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <h3 className="font-semibold truncate">{b.name}</h3>
              <StatusBadge status={b.status} />
              {isArchived && (
                <Badge variant="outline" className="text-[10px] bg-muted">archived</Badge>
              )}
              {b.paperTrading && (
                <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-700 dark:text-yellow-400">
                  paper
                </Badge>
              )}
              <Badge variant="outline" className="font-mono text-[10px]">{b.symbol}</Badge>
              <Badge variant="secondary" className="text-[10px]">{b.strategy?.name ?? '—'}</Badge>
              {lt && lt.totalRuns > 0 && (
                <Badge variant="outline" className="text-[10px] bg-primary/5">
                  {lt.totalRuns} run{lt.totalRuns === 1 ? '' : 's'}
                </Badge>
              )}
              {(() => {
                const dir = (b.params?.direction as string | undefined)?.toUpperCase();
                if (!dir || (dir !== 'BUY' && dir !== 'SELL')) return null;
                return (
                  <Badge
                    variant={dir === 'BUY' ? 'success' : 'destructive'}
                    className="text-[10px] font-mono"
                  >
                    {dir}
                  </Badge>
                );
              })()}
              {b.startedAt && isRunning && (
                <span className="text-xs text-muted-foreground">running {formatDuration(b.startedAt)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.preventDefault()}>
              {isRunning ? (
                <Button variant="outline" size="sm" disabled={stopPending} onClick={onStop}>Stop</Button>
              ) : (
                <Button variant="success" size="sm" disabled={startPending} onClick={onStart}>
                  {hasRunHistory ? 'Resume' : 'Start'}
                </Button>
              )}
              {isArchived ? (
                <Button variant="ghost" size="sm" disabled={archivePending} onClick={onUnarchive}>
                  <ArchiveRestore className="h-3.5 w-3.5 mr-1" /> Restore
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled={archivePending || isRunning} onClick={onArchive}>
                  <Archive className="h-3.5 w-3.5 mr-1" /> Archive
                </Button>
              )}
            </div>
          </div>

          {/* Lifetime stats row — only when at least 1 prior run */}
          {lt && lt.totalRuns > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 pb-3 border-b border-dashed">
              <Field icon={<Trophy className="h-3 w-3" />} label="Lifetime"
                value={`${lt.realized >= 0 ? '+' : ''}${formatNumber(lt.realized, { maximumFractionDigits: 2 })} ${b.quoteAsset}`}
                valueClass={lt.realized >= 0 ? 'text-success' : 'text-destructive'} />
              <Field icon={<Repeat className="h-3 w-3" />} label="Lifetime cycles"
                value={String(lt.cycles)} />
              <Field icon={<Coins className="h-3 w-3" />} label="Lifetime volume"
                value={formatNumber(lt.volume, { maximumFractionDigits: 0 })} />
              <Field icon={<Repeat className="h-3 w-3" />} label="Total runs"
                value={String(lt.totalRuns)} />
            </div>
          )}

          {/* Grid params row (3) */}
          {ls && (ls.gridLevels !== null || ls.gridSpread !== null) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <Field icon={<Layers className="h-3 w-3" />} label="Levels"
                value={ls.gridLevels !== null ? `${ls.gridLevels} × 2` : '—'} />
              <Field icon={<Coins className="h-3 w-3" />} label="Spread"
                value={ls.gridSpread !== null ? `$${formatNumber(ls.gridSpread, { maximumFractionDigits: 2 })}` : '—'} />
              <Field icon={<Coins className="h-3 w-3" />} label="Total invested"
                value={ls.totalInvestment !== null
                  ? `$${formatNumber(ls.totalInvestment, { maximumFractionDigits: 2 })}`
                  : '—'} />
              <Field icon={<Repeat className="h-3 w-3" />} label="Expected / cycle"
                value={ls.expectedPerCycle !== null
                  ? `$${formatNumber(ls.expectedPerCycle, { maximumFractionDigits: 4 })}`
                  : '—'} />
            </div>
          )}

          {/* PnL row (4 / 5 / 6) */}
          <div className="grid grid-cols-3 gap-3 pt-3 border-t">
            <Field icon={<Repeat className="h-3 w-3" />} label="Completed cycles"
              value={String(ls?.cyclesCompleted ?? 0)} />
            <Field
              icon={ls && ls.realized >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              label="Realized P&L"
              value={ls
                ? `${ls.realized >= 0 ? '+' : ''}${formatNumber(ls.realized, { maximumFractionDigits: 4 })} ${b.quoteAsset}`
                : '—'}
              valueClass={ls && ls.realized > 0 ? 'text-success'
                : ls && ls.realized < 0 ? 'text-destructive' : ''}
            />
            <Field
              icon={ls && ls.total >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              label="Total profits"
              value={ls
                ? `${ls.total >= 0 ? '+' : ''}${formatNumber(ls.total, { maximumFractionDigits: 4 })} ${b.quoteAsset}`
                : '—'}
              valueClass={totalTone}
            />
          </div>
        </Link>
      </CardContent>
    </Card>
  );
}

function Field({
  icon, label, value, valueClass,
}: { icon?: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
        {icon}{label}
      </div>
      <div className={`text-sm font-mono font-semibold tabular-nums ${valueClass ?? ''}`}>{value}</div>
    </div>
  );
}
