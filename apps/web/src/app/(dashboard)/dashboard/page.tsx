'use client';
import Link from 'next/link';
import {
  Activity, Bot, DollarSign, Key, TrendingUp, TrendingDown,
  Repeat, Wallet, BarChart3, Trophy, AlertCircle, Layers, Coins,
} from 'lucide-react';
import { useBots, useExchangeKeys, type Bot as BotType } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatNumber, formatDuration } from '@/lib/utils';

export default function DashboardPage() {
  const { data: bots } = useBots();
  const { data: keys } = useExchangeKeys();

  const allBots = bots ?? [];
  const running = allBots.filter((b) => b.status === 'RUNNING' || b.status === 'STARTING');
  const stopped = allBots.filter((b) => b.status === 'STOPPED');
  const errored = allBots.filter((b) => b.status === 'ERROR');

  // ─── Aggregate KPIs from authoritative liveStats (NOT bot.realizedPnlQuote) ───
  const sum = (selector: (b: BotType) => number) =>
    allBots.reduce((acc, b) => acc + (Number.isFinite(selector(b)) ? selector(b) : 0), 0);
  const totalRealized = sum((b) => b.liveStats?.realized ?? 0);
  const totalFloating = sum((b) => b.liveStats?.unrealized ?? 0);
  const totalProfits = totalRealized + totalFloating;
  const totalCycles = sum((b) => b.liveStats?.cyclesCompleted ?? 0);
  const totalInvestment = sum((b) => b.liveStats?.totalInvestment ?? 0);
  const totalVolume = sum((b) => b.liveStats?.totalVolumeQuote ?? 0);
  const totalTrades = sum((b) => b.liveStats?.tradeCount ?? 0);
  const portfolioRoi = totalInvestment > 0 ? (totalRealized / totalInvestment) * 100 : null;

  // ─── Derived insights ───
  const sortedByPnl = [...allBots]
    .filter((b) => b.liveStats)
    .sort((a, b) => (b.liveStats!.total) - (a.liveStats!.total));
  const topPerformers = sortedByPnl.slice(0, 3);
  const worstPerformer = sortedByPnl[sortedByPnl.length - 1];
  const hasNegativeWorst = worstPerformer && worstPerformer.liveStats!.total < 0;

  return (
    <div className="space-y-6 max-w-7xl">
      <OnboardingWizard />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Live portfolio overview · {running.length} running · {totalCycles} cycles closed
          </p>
        </div>
        <Button asChild><Link href="/bots/new">Create bot</Link></Button>
      </div>

      {/* ─── Headline P&L row (3 large tiles) ─── */}
      <div className="grid gap-4 md:grid-cols-3">
        <KpiTile
          icon={totalProfits >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          label="Total Profits"
          value={signed(totalProfits, 4)}
          sub="Realized + Floating · all bots"
          tone={tone(totalProfits)}
          big
          accent
        />
        <KpiTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Realized P&L"
          value={signed(totalRealized, 4)}
          sub={`${totalCycles} closed cycle${totalCycles === 1 ? '' : 's'}`}
          tone={tone(totalRealized)}
        />
        <KpiTile
          icon={totalFloating >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          label="Floating P&L"
          value={totalFloating === 0 ? '—' : signed(totalFloating, 4)}
          sub={totalFloating === 0 ? 'No held inventory' : 'Unrealized from open positions'}
          tone={tone(totalFloating)}
        />
      </div>

      {/* ─── Secondary metrics row (4 tiles) ─── */}
      <div className="grid gap-4 md:grid-cols-4">
        <KpiTile
          icon={<Bot className="h-4 w-4" />}
          label="Bots"
          value={String(allBots.length)}
          sub={`${running.length} running · ${stopped.length} stopped${errored.length ? ` · ${errored.length} error` : ''}`}
        />
        <KpiTile
          icon={<Repeat className="h-4 w-4" />}
          label="Cycles closed"
          value={formatNumber(totalCycles, { maximumFractionDigits: 0 })}
          sub={totalCycles > 0
            ? `avg ${signed(totalRealized / totalCycles, 4)} / cycle`
            : 'no closed cycles yet'}
        />
        <KpiTile
          icon={<BarChart3 className="h-4 w-4" />}
          label="Total Volume"
          value={formatNumber(totalVolume, { maximumFractionDigits: 2 })}
          sub={`${totalTrades} trade${totalTrades === 1 ? '' : 's'}`}
        />
        <KpiTile
          icon={<Coins className="h-4 w-4" />}
          label="Capital Deployed"
          value={formatNumber(totalInvestment, { maximumFractionDigits: 2 })}
          sub={portfolioRoi !== null
            ? `ROI ${portfolioRoi >= 0 ? '+' : ''}${portfolioRoi.toFixed(3)}%`
            : 'sum of bot investments'}
        />
      </div>

      {/* ─── Lower row: Top performers + Active bots + Account ─── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Top performers */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-500" />
              Top performers
            </CardTitle>
            <CardDescription className="text-xs">By total profits.</CardDescription>
          </CardHeader>
          <CardContent>
            {topPerformers.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No bot data yet.</p>
            ) : (
              <ol className="space-y-2">
                {topPerformers.map((b, i) => {
                  const t = b.liveStats?.total ?? 0;
                  return (
                    <li key={b.id}>
                      <Link
                        href={`/bots/${b.id}`}
                        className="flex items-center justify-between gap-2 text-sm hover:bg-accent/40 -mx-2 px-2 py-1.5 rounded"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-base">
                            {['🥇', '🥈', '🥉'][i]}
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{b.name}</div>
                            <div className="text-[10px] text-muted-foreground font-mono truncate">
                              {b.symbol} · {b.liveStats?.cyclesCompleted ?? 0} cycles
                            </div>
                          </div>
                        </div>
                        <span className={`font-mono text-sm tabular-nums whitespace-nowrap ${
                          t > 0 ? 'text-success' : t < 0 ? 'text-destructive' : 'text-muted-foreground'
                        }`}>
                          {signed(t, 4)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Bots needing attention */}
        <Card className={errored.length > 0 || hasNegativeWorst ? 'border-yellow-500/40' : undefined}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className={`h-4 w-4 ${errored.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
              Needs attention
            </CardTitle>
            <CardDescription className="text-xs">
              Bots with errors or worst floating P&L.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {errored.length === 0 && !hasNegativeWorst ? (
              <p className="text-xs text-muted-foreground italic">All bots healthy.</p>
            ) : (
              <>
                {errored.map((b) => (
                  <Link
                    key={b.id}
                    href={`/bots/${b.id}`}
                    className="flex items-center justify-between gap-2 text-sm hover:bg-accent/40 -mx-2 px-2 py-1.5 rounded"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{b.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{b.symbol}</div>
                    </div>
                    <Badge variant="destructive" className="text-[10px]">ERROR</Badge>
                  </Link>
                ))}
                {hasNegativeWorst && worstPerformer && !errored.some((e) => e.id === worstPerformer.id) && (
                  <Link
                    href={`/bots/${worstPerformer.id}`}
                    className="flex items-center justify-between gap-2 text-sm hover:bg-accent/40 -mx-2 px-2 py-1.5 rounded"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{worstPerformer.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {worstPerformer.symbol} · worst total
                      </div>
                    </div>
                    <span className="font-mono text-xs text-destructive tabular-nums">
                      {signed(worstPerformer.liveStats!.total, 4)}
                    </span>
                  </Link>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Account snapshot */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4 text-primary" />
              Account
            </CardTitle>
            <CardDescription className="text-xs">Quick overview & shortcuts.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 text-xs">
              <Row label="API keys" value={String(keys?.length ?? 0)} />
              <Row label="Total bots" value={String(allBots.length)} />
              <Row label="Running now" value={String(running.length)} />
              <Row label="Held inventory" value={
                formatNumber(sum((b) => b.liveStats?.heldQty ?? 0), { maximumFractionDigits: 8 })
              } />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t">
              <Button asChild size="sm" variant="outline"><Link href="/exchange-keys">Keys</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/wallet">Wallet</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Active bots list (existing — enhanced with profit per row) ─── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Active bots
            </CardTitle>
            <Link href="/bots" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
        </CardHeader>
        <CardContent>
          {allBots.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="mb-4">No bots yet. Get started by creating your first one.</p>
              <Button asChild><Link href="/bots/new">Create your first bot</Link></Button>
            </div>
          ) : (
            <div className="divide-y">
              {allBots.slice(0, 8).map((b) => {
                const ls = b.liveStats;
                const total = ls?.total ?? 0;
                const isRun = b.status === 'RUNNING' || b.status === 'STARTING';
                const direction = (b.params?.direction as string | undefined)?.toUpperCase();
                return (
                  <Link
                    key={b.id}
                    href={`/bots/${b.id}`}
                    className="flex items-center justify-between py-3 hover:bg-accent/30 -mx-2 px-2 rounded gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-medium truncate">{b.name}</span>
                        <StatusBadge status={b.status} />
                        <Badge variant="outline" className="font-mono text-[10px]">{b.symbol}</Badge>
                        {direction === 'BUY' || direction === 'SELL' ? (
                          <Badge
                            variant={direction === 'BUY' ? 'success' : 'destructive'}
                            className="text-[10px] font-mono"
                          >
                            {direction}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span>{b.strategy?.name ?? '—'}</span>
                        {ls && ls.gridLevels !== null && ls.gridSpread !== null && (
                          <>
                            <span>·</span>
                            <span className="font-mono flex items-center gap-1">
                              <Layers className="h-3 w-3" />
                              {ls.gridLevels} × ${formatNumber(ls.gridSpread, { maximumFractionDigits: 2 })}
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <span className="font-mono">
                          {ls?.cyclesCompleted ?? 0} cycles
                        </span>
                        {b.startedAt && isRun && (
                          <>
                            <span>·</span>
                            <span className="font-mono">{formatDuration(b.startedAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono tabular-nums text-sm font-semibold ${
                        total > 0 ? 'text-success' : total < 0 ? 'text-destructive' : 'text-muted-foreground'
                      }`}>
                        {signed(total, 4)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {b.quoteAsset}
                      </div>
                    </div>
                  </Link>
                );
              })}
              {allBots.length > 8 && (
                <Link
                  href="/bots"
                  className="block text-center text-xs text-primary hover:underline pt-3"
                >
                  + {allBots.length - 8} more bot{allBots.length - 8 === 1 ? '' : 's'} →
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Bottom strip: legacy stats for users who still want them ─── */}
      {keys && keys.length > 0 && (
        <Card className="bg-muted/20">
          <CardContent className="p-4 flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-3">
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              <span>P&L numbers above use authoritative cycle-based math from strategy state.</span>
            </div>
            <div className="flex items-center gap-3">
              <span><Wallet className="h-3 w-3 inline" /> {keys.length} API key{keys.length === 1 ? '' : 's'}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Helpers ───

function tone(n: number): 'positive' | 'negative' | undefined {
  if (n === 0) return undefined;
  return n > 0 ? 'positive' : 'negative';
}

function signed(n: number, decimals = 4): string {
  if (!Number.isFinite(n)) return '—';
  const abs = formatNumber(n, { maximumFractionDigits: decimals });
  return n > 0 ? `+${abs}` : `${abs}`;
}

function KpiTile({
  icon, label, value, sub, tone, big, accent,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'negative';
  big?: boolean;
  accent?: boolean;
}) {
  const toneClass = tone === 'positive' ? 'text-success'
    : tone === 'negative' ? 'text-destructive'
    : '';
  return (
    <Card className={accent ? 'border-2 border-primary/20' : undefined}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          {icon && <span className="text-muted-foreground">{icon}</span>}
        </div>
        <div className={`font-bold tabular-nums ${toneClass} ${big ? 'text-3xl' : 'text-2xl'}`}>
          {value}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold tabular-nums">{value}</span>
    </div>
  );
}
