'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
} from 'recharts';
import {
  useReportsOverview, usePnlSeries, usePerBotBreakdown,
  usePerSymbolBreakdown, useBestWorstDay,
} from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { formatNumber } from '@/lib/utils';
import {
  TrendingUp, TrendingDown, Repeat, Coins, Trophy, Skull,
  BarChart3, ArrowUpDown, Calendar,
} from 'lucide-react';

type Sortable = 'name' | 'cycles' | 'realized' | 'unrealized' | 'total' | 'volume' | 'roi';

export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const [sortBy, setSortBy] = useState<Sortable>('total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { data: overview, isLoading: loadingOverview } = useReportsOverview();
  const { data: series } = usePnlSeries(days);
  const { data: perBot } = usePerBotBreakdown();
  const { data: perSymbol } = usePerSymbolBreakdown();
  const { data: bestWorst } = useBestWorstDay(days);

  // ─── Sorted per-bot table ───
  const sortedBots = useMemo(() => {
    if (!perBot) return [];
    const arr = [...perBot];
    arr.sort((a, b) => {
      const v = (() => {
        switch (sortBy) {
          case 'name': return a.name.localeCompare(b.name);
          case 'cycles': return a.cycles - b.cycles;
          case 'realized': return a.realized - b.realized;
          case 'unrealized': return a.unrealized - b.unrealized;
          case 'volume': return a.volume - b.volume;
          case 'roi': return (a.roi ?? -Infinity) - (b.roi ?? -Infinity);
          case 'total':
          default: return a.total - b.total;
        }
      })();
      return sortDir === 'desc' ? -v : v;
    });
    return arr;
  }, [perBot, sortBy, sortDir]);

  const headerSort = (col: Sortable) => () => {
    if (sortBy === col) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortBy(col); setSortDir('desc'); }
  };

  const totals = overview?.totals;
  const roiText = totals?.roiPct !== null && totals?.roiPct !== undefined
    ? `${totals.roiPct >= 0 ? '+' : ''}${totals.roiPct.toFixed(3)}%`
    : '—';
  const winRateText = totals?.winRate !== null && totals?.winRate !== undefined
    ? `${totals.winRate.toFixed(1)}%`
    : '—';

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            Authoritative performance analytics from cycle-based P&L.
          </p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90, 365].map((d) => (
            <Button
              key={d}
              variant={d === days ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>

      {loadingOverview && !overview ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : null}

      {/* ─── Headline KPIs (4 large) ─── */}
      <div className="grid gap-4 md:grid-cols-4">
        <KpiTile
          icon={(totals?.total ?? 0) >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          label="Total Profits"
          value={signed(totals?.total)}
          sub="Realized + Floating"
          tone={tone(totals?.total)}
          big
          accent
        />
        <KpiTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Realized P&L"
          value={signed(totals?.realized)}
          sub={totals?.cycles
            ? `${totals.cycles} cycle${totals.cycles === 1 ? '' : 's'} · avg ${signed(totals.avgPerCycle ?? 0)}`
            : 'no closed cycles'}
          tone={tone(totals?.realized)}
        />
        <KpiTile
          icon={<TrendingDown className="h-4 w-4" />}
          label="Floating P&L"
          value={totals && totals.unrealized !== 0 ? signed(totals.unrealized) : '—'}
          sub={totals?.unrealized === 0 ? 'no held inventory' : 'unrealized open positions'}
          tone={tone(totals?.unrealized)}
        />
        <KpiTile
          icon={<Coins className="h-4 w-4" />}
          label="ROI"
          value={roiText}
          sub={totals?.investment
            ? `on ${formatNumber(totals.investment, { maximumFractionDigits: 2 })} invested`
            : '—'}
          tone={(totals?.roiPct ?? 0) > 0 ? 'positive' : (totals?.roiPct ?? 0) < 0 ? 'negative' : undefined}
        />
      </div>

      {/* ─── Secondary metrics row ─── */}
      <div className="grid gap-4 md:grid-cols-4">
        <KpiTile
          icon={<Repeat className="h-4 w-4" />}
          label="Cycles closed"
          value={String(totals?.cycles ?? 0)}
          sub={totals?.wins !== undefined
            ? `${totals.wins} wins · ${totals.losses} losses`
            : '—'}
        />
        <KpiTile
          icon={<Trophy className="h-4 w-4" />}
          label="Win Rate"
          value={winRateText}
          sub={totals?.wins !== undefined && totals.wins + totals.losses > 0
            ? `${totals.wins} of ${totals.wins + totals.losses} cycles`
            : 'no decisive cycles yet'}
          tone={(totals?.winRate ?? 0) >= 50 ? 'positive' : (totals?.winRate ?? 0) > 0 ? 'negative' : undefined}
        />
        <KpiTile
          icon={<BarChart3 className="h-4 w-4" />}
          label="Total Volume"
          value={formatNumber(totals?.volume ?? 0, { maximumFractionDigits: 2 })}
          sub={`${totals?.trades ?? 0} trade${(totals?.trades ?? 0) === 1 ? '' : 's'}`}
        />
        <KpiTile
          icon={<ArrowUpDown className="h-4 w-4" />}
          label="Bots"
          value={String(overview?.bots.total ?? 0)}
          sub={overview
            ? `${overview.bots.running} run · ${overview.bots.stopped} stop${overview.bots.errored ? ` · ${overview.bots.errored} err` : ''}`
            : '—'}
        />
      </div>

      {/* ─── Cumulative P&L line chart ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cumulative P&amp;L · last {days} days</CardTitle>
          <CardDescription className="text-xs">
            Running total of realized PnL from closed cycles. Daily bars below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!series?.length ? (
            <p className="text-sm text-muted-foreground py-12 text-center">No data in this window.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, k: string) => [
                    typeof v === 'number' ? formatNumber(v, { maximumFractionDigits: 4 }) : String(v),
                    k === 'cumulative' ? 'Cumulative' : k === 'pnl' ? 'Daily PnL' : k,
                  ]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" />
                <Line type="monotone" dataKey="cumulative" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ─── Daily PnL bars + Daily Cycles bars ─── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daily P&amp;L</CardTitle>
            <CardDescription className="text-xs">Green = profitable day, red = loss.</CardDescription>
          </CardHeader>
          <CardContent>
            {!series?.length ? (
              <p className="text-sm text-muted-foreground py-12 text-center">No trades.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => formatNumber(v, { maximumFractionDigits: 4 })}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" />
                  <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                    {series.map((d, i) => (
                      <Cell
                        key={i}
                        fill={d.pnl >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cycles per day</CardTitle>
            <CardDescription className="text-xs">How many BUY↔SELL round-trips closed each day.</CardDescription>
          </CardHeader>
          <CardContent>
            {!series?.length ? (
              <p className="text-sm text-muted-foreground py-12 text-center">No cycles.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="cycles" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Best / Worst day + Per-symbol breakdown ─── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Best day */}
        <Card className="border-success/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-success" />Best day
            </CardTitle>
            <CardDescription className="text-xs">Highest single-day PnL in window.</CardDescription>
          </CardHeader>
          <CardContent>
            {bestWorst?.best ? (
              <BestDayBlock day={bestWorst.best} positive />
            ) : (
              <p className="text-xs text-muted-foreground italic">No profitable day yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Worst day */}
        <Card className={bestWorst?.worst ? 'border-destructive/30' : undefined}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Skull className="h-4 w-4 text-destructive" />Worst day
            </CardTitle>
            <CardDescription className="text-xs">Largest drawdown day in window.</CardDescription>
          </CardHeader>
          <CardContent>
            {bestWorst?.worst ? (
              <BestDayBlock day={bestWorst.worst} positive={false} />
            ) : (
              <p className="text-xs text-muted-foreground italic">No losing day. Nice.</p>
            )}
          </CardContent>
        </Card>

        {/* Per-symbol breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />By symbol
            </CardTitle>
            <CardDescription className="text-xs">Aggregate per trading pair.</CardDescription>
          </CardHeader>
          <CardContent>
            {!perSymbol?.length ? (
              <p className="text-xs text-muted-foreground italic">No bots yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {perSymbol.map((s) => (
                  <li key={s.symbol} className="flex items-center justify-between border-b last:border-b-0 pb-2 last:pb-0">
                    <div>
                      <div className="font-mono font-semibold">{s.symbol}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.bots} bot{s.bots === 1 ? '' : 's'} · {s.cycles} cycles
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono tabular-nums ${
                        s.total > 0 ? 'text-success' : s.total < 0 ? 'text-destructive' : 'text-muted-foreground'
                      }`}>
                        {signed(s.total)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        vol {formatNumber(s.volume, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Per-bot performance table ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Per-bot performance</CardTitle>
          <CardDescription className="text-xs">Click any column header to sort.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <Th label="Bot" col="name" sortBy={sortBy} sortDir={sortDir} onClick={headerSort('name')} />
                <Th label="Cycles" col="cycles" sortBy={sortBy} sortDir={sortDir} onClick={headerSort('cycles')} align="right" />
                <Th label="Realized" col="realized" sortBy={sortBy} sortDir={sortDir} onClick={headerSort('realized')} align="right" />
                <Th label="Floating" col="unrealized" sortBy={sortBy} sortDir={sortDir} onClick={headerSort('unrealized')} align="right" />
                <Th label="Total" col="total" sortBy={sortBy} sortDir={sortDir} onClick={headerSort('total')} align="right" />
                <Th label="Volume" col="volume" sortBy={sortBy} sortDir={sortDir} onClick={headerSort('volume')} align="right" />
                <Th label="ROI" col="roi" sortBy={sortBy} sortDir={sortDir} onClick={headerSort('roi')} align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedBots.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-muted-foreground py-12">No bots yet.</td></tr>
              ) : (
                sortedBots.map((b) => (
                  <tr key={b.id} className="border-b last:border-b-0 hover:bg-accent/30">
                    <td className="px-3 py-2.5">
                      <Link href={`/bots/${b.id}`} className="block">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{b.name}</span>
                          <StatusBadge status={b.status} />
                          {b.paperTrading && (
                            <Badge variant="outline" className="text-[9px] border-yellow-500/50 text-yellow-700 dark:text-yellow-400">paper</Badge>
                          )}
                          {b.direction && (
                            <Badge variant={b.direction === 'BUY' ? 'success' : 'destructive'} className="text-[9px] font-mono">
                              {b.direction}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {b.symbol} · {b.strategy}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{b.cycles}</td>
                    <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                      b.realized > 0 ? 'text-success' : b.realized < 0 ? 'text-destructive' : 'text-muted-foreground'
                    }`}>{signed(b.realized)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                      b.unrealized > 0 ? 'text-success' : b.unrealized < 0 ? 'text-destructive' : 'text-muted-foreground'
                    }`}>{b.unrealized === 0 ? '—' : signed(b.unrealized)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono tabular-nums font-semibold ${
                      b.total > 0 ? 'text-success' : b.total < 0 ? 'text-destructive' : 'text-muted-foreground'
                    }`}>{signed(b.total)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                      {formatNumber(b.volume, { maximumFractionDigits: 2 })}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                      b.roi !== null && b.roi > 0 ? 'text-success' : b.roi !== null && b.roi < 0 ? 'text-destructive' : 'text-muted-foreground'
                    }`}>
                      {b.roi === null ? '—' : `${b.roi >= 0 ? '+' : ''}${b.roi.toFixed(2)}%`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function tone(n: number | undefined): 'positive' | 'negative' | undefined {
  if (n === undefined || n === 0) return undefined;
  return n > 0 ? 'positive' : 'negative';
}

function signed(n: number | undefined | null, decimals = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
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

function BestDayBlock({
  day, positive,
}: {
  day: { date: string; pnl: number; cycles: number; volume: number };
  positive: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums ${positive ? 'text-success' : 'text-destructive'}`}>
          {day.pnl >= 0 ? '+' : ''}{formatNumber(day.pnl, { maximumFractionDigits: 4 })}
        </span>
      </div>
      <div className="text-xs font-mono text-muted-foreground">
        {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {day.cycles} cycle{day.cycles === 1 ? '' : 's'} ·
        {' '}vol {formatNumber(day.volume, { maximumFractionDigits: 2 })}
      </div>
    </div>
  );
}

function Th({
  label, col, sortBy, sortDir, onClick, align,
}: {
  label: string;
  col: Sortable;
  sortBy: Sortable;
  sortDir: 'asc' | 'desc';
  onClick: () => void;
  align?: 'right';
}) {
  const active = sortBy === col;
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground transition-colors ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${active ? 'text-foreground' : ''}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-[10px]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
      </span>
    </th>
  );
}
