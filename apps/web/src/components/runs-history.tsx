'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useBotRuns, useReplayRun, type BotRunRow } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';
import { Play, Clock, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';

/**
 * Per-bot history of execution sessions. Each row is one start→stop cycle of
 * the bot with the params that were active during that run, final PnL, and a
 * Replay button that copies the paramsSnapshot back and starts a new run.
 */
export function RunsHistory({ botId, botStatus }: { botId: string; botStatus: string }) {
  const { data: runs } = useBotRuns(botId);
  const replay = useReplayRun();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!runs) return <p className="text-muted-foreground text-sm">Loading runs…</p>;
  if (runs.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground italic">
          No runs yet. Click <strong>Start</strong> to launch your first session.
        </CardContent>
      </Card>
    );
  }

  const canReplay = botStatus !== 'RUNNING' && botStatus !== 'STARTING';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" /> Run History
          <Badge variant="outline" className="text-[10px]">{runs.length} run{runs.length === 1 ? '' : 's'}</Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Each Start creates a new run with frozen params. Stats below are per-run; bot-wide totals appear in the Lifetime tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 w-8"></th>
              <th className="text-left px-3 py-2">#</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Started</th>
              <th className="text-left px-3 py-2">Duration</th>
              <th className="text-right px-3 py-2">Realized</th>
              <th className="text-right px-3 py-2">Cycles</th>
              <th className="text-right px-3 py-2">Trades</th>
              <th className="text-right px-3 py-2">Volume</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const isExpanded = expanded === r.id;
              const realized = Number(r.realizedPnl);
              return (
                <>
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-1.5">
                      <button onClick={() => setExpanded(isExpanded ? null : r.id)}
                        className="text-muted-foreground hover:text-foreground">
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">#{r.runNumber}</td>
                    <td className="px-3 py-1.5">
                      <Badge variant={r.status === 'RUNNING' ? 'success'
                        : r.status === 'ERROR' ? 'destructive' : 'outline'}
                        className="text-[10px]">
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                      <div>{new Date(r.startedAt).toLocaleDateString()}</div>
                      <div className="text-[10px] text-muted-foreground">{new Date(r.startedAt).toLocaleTimeString()}</div>
                    </td>
                    <td className="px-3 py-1.5 text-xs font-mono">{formatDuration(r.durationMs)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${realized >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {realized >= 0 ? '+' : ''}{formatNumber(realized, { maximumFractionDigits: 4 })}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-xs">{r.cyclesCompleted}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-xs">{r.tradesCount}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-xs">
                      {formatNumber(Number(r.volumeQuote), { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {r.status !== 'RUNNING' && (
                        <Button size="sm" variant="ghost"
                          disabled={!canReplay || replay.isPending}
                          title={canReplay ? 'Replay these params as a new run' : 'Stop the bot to replay'}
                          onClick={() => {
                            if (!confirm(`Replay run #${r.runNumber}? This will set the bot's params to that run's snapshot and start a new run.`)) return;
                            replay.mutate({ botId, runId: r.id }, {
                              onSuccess: () => toast.success(`Replaying run #${r.runNumber} as new run`),
                              onError: (e) => toast.error(e.message),
                            });
                          }}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b bg-muted/10">
                      <td colSpan={10} className="px-3 py-2">
                        <RunDetails run={r} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function RunDetails({ run }: { run: BotRunRow }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 text-xs">
      <div>
        <div className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          Params snapshot
        </div>
        <pre className="bg-background border rounded-md p-2 max-h-[200px] overflow-y-auto font-mono text-[11px]">
          {JSON.stringify(run.paramsSnapshot, null, 2)}
        </pre>
      </div>
      <div className="space-y-1">
        <div className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          Summary
        </div>
        <Row label="Stop reason" value={run.stopReason ?? '—'} />
        {run.initialStartPrice && <Row label="Initial start price" value={formatNumber(Number(run.initialStartPrice))} />}
        {run.unrealizedAtStop && <Row label="Unrealized at stop" value={formatNumber(Number(run.unrealizedAtStop), { maximumFractionDigits: 4 })} />}
        {run.maxDrawdownAbs && <Row label="Max drawdown" value={`−${formatNumber(Number(run.maxDrawdownAbs), { maximumFractionDigits: 4 })}`} />}
        <Row label="Fees" value={formatNumber(Number(run.fees), { maximumFractionDigits: 6 })} />
        {run.stoppedAt && <Row label="Stopped" value={new Date(run.stoppedAt).toLocaleString()} />}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function formatDuration(ms: string | null): string {
  if (!ms) return '—';
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const seconds = Math.floor(n / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `${hours}h ${mins}m`;
  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  return `${days}d ${hrs}h`;
}
