'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, BarChart3, Bell, Camera,
  Coins, Download, History, Layers, PieChart, RefreshCw, Sparkles, TrendingUp,
  TrendingDown, Wallet, Wrench, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useExchangeKeys } from '@/lib/queries';
import {
  useWalletEnriched, useOpenOrders, useCancelWalletOrder, useCancelAllOrders,
  useDeposits, useWithdrawals, useAllTrades,
  useCostBasis, useSnapshots, useSnapshotNow,
  useConvertDust, usePriceAlerts, useCreateAlert, useToggleAlert, useDeleteAlert,
  type EnrichedBalance,
} from '@/lib/queries-wallet';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { TradeModal } from '@/components/trade-modal';
import { api } from '@/lib/api';
import { formatNumber, formatRelativeTime, cn } from '@/lib/utils';

type Tab = 'holdings' | 'activity' | 'performance' | 'tools';

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'holdings',    label: 'Holdings',    icon: PieChart },
  { key: 'activity',    label: 'Activity',    icon: History },
  { key: 'performance', label: 'Performance', icon: BarChart3 },
  { key: 'tools',       label: 'Tools',       icon: Wrench },
];

export default function WalletPage() {
  const { data: keys } = useExchangeKeys();
  const activeKeys = keys?.filter((k) => k.status === 'ACTIVE') ?? [];
  const [apiKeyId, setApiKeyId] = useState<string | undefined>();
  const [tab, setTab] = useState<Tab>('holdings');
  const [tradingAsset, setTradingAsset] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKeyId && activeKeys.length) setApiKeyId(activeKeys[0]!.id);
  }, [activeKeys, apiKeyId]);

  const { data: overview, isFetching, refetch } = useWalletEnriched(apiKeyId);
  const fdusdBalance = overview?.balances.find((b) => b.asset === 'FDUSD');
  const tradingBalance = overview?.balances.find((b) => b.asset === tradingAsset);

  if (!activeKeys.length) {
    return (
      <Card className="max-w-2xl">
        <CardHeader><CardTitle>No active API key</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Add a Binance API key first to view your wallet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" />
            Wallet
          </h1>
          <p className="text-muted-foreground">Portfolio, trades, deposits/withdrawals, alerts.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={apiKeyId ?? ''}
            onChange={(e) => setApiKeyId(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            {activeKeys.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <Button variant="outline" size="icon" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Portfolio summary card with 24h change */}
      {overview && <PortfolioSummary overview={overview} />}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap',
                active ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}>
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {apiKeyId && tab === 'holdings' && (
        <HoldingsTab
          apiKeyId={apiKeyId}
          overview={overview}
          onTrade={(asset) => setTradingAsset(asset)}
        />
      )}
      {apiKeyId && tab === 'activity' && <ActivityTab apiKeyId={apiKeyId} />}
      {apiKeyId && tab === 'performance' && <PerformanceTab apiKeyId={apiKeyId} />}
      {apiKeyId && tab === 'tools' && <ToolsTab apiKeyId={apiKeyId} balances={overview?.balances ?? []} />}

      {/* Trade modal */}
      {tradingAsset && tradingBalance && apiKeyId && (
        <TradeModal
          apiKeyId={apiKeyId}
          asset={tradingAsset}
          balance={tradingBalance}
          fdusdBalance={fdusdBalance}
          onClose={() => setTradingAsset(null)}
        />
      )}
    </div>
  );
}

// ─── Portfolio summary header ───

function PortfolioSummary({ overview }: { overview: NonNullable<ReturnType<typeof useWalletEnriched>['data']> }) {
  const total = Number(overview.totalFdusdValue);
  const ch = overview.change24h;
  return (
    <Card className="bg-gradient-to-br from-primary/10 to-accent/30 border-primary/30">
      <CardContent className="p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-sm text-muted-foreground mb-1">Total portfolio value</div>
            <div className="text-4xl font-bold flex items-baseline gap-2">
              <span>{formatNumber(total, { maximumFractionDigits: 2 })}</span>
              <span className="text-base text-muted-foreground font-normal">FDUSD</span>
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-1">24h change</div>
            <div className={cn('text-2xl font-bold flex items-center gap-1',
              ch.absolute >= 0 ? 'text-success' : 'text-destructive')}>
              {ch.absolute >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              {ch.absolute >= 0 ? '+' : ''}{formatNumber(ch.absolute, { maximumFractionDigits: 2 })}
              <span className="text-base font-normal ml-1">
                ({ch.percentage >= 0 ? '+' : ''}{ch.percentage.toFixed(2)}%)
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              vs {formatNumber(ch.valueAgo, { maximumFractionDigits: 2 })} 24h ago
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Assets</div>
              <div className="text-xl font-bold tabular-nums">{overview.assetCount}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Tradeable</div>
              <div className="text-xl font-bold tabular-nums">{overview.tradeableCount}</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Holdings tab ───

function HoldingsTab({ apiKeyId, overview, onTrade }: {
  apiKeyId: string;
  overview: ReturnType<typeof useWalletEnriched>['data'];
  onTrade: (asset: string) => void;
}) {
  const [hideZero, setHideZero] = useState(true);
  const { data: openOrders } = useOpenOrders(apiKeyId);
  const cancel = useCancelWalletOrder();
  const cancelAll = useCancelAllOrders();

  // Counts surface in the strip header so the user knows what "cancel all" will do.
  const manualCount = openOrders?.filter((o) => o.clientOrderId.startsWith('orca-wallet')).length ?? 0;
  const botCount = openOrders?.filter((o) =>
    o.clientOrderId.startsWith('orca-') && !o.clientOrderId.startsWith('orca-wallet'),
  ).length ?? 0;

  const runCancelAll = (includeBots: boolean) => {
    const target = includeBots ? openOrders?.length ?? 0 : manualCount;
    if (target === 0) {
      toast.info(includeBots ? 'No orders to cancel.' : 'No manual orders to cancel.');
      return;
    }
    const warning = includeBots && botCount > 0
      ? `\n\n⚠️ This will also cancel ${botCount} bot order(s). Running bots will detect the missing orders within ~60s and re-place them automatically.`
      : '';
    if (!confirm(`Cancel ${target} ${includeBots ? '' : 'manual'} pending order(s)?${warning}`)) return;
    cancelAll.mutate({ apiKeyId, includeBots }, {
      onSuccess: (r) => {
        if (r.failed > 0) {
          toast.warning(`Cancelled ${r.cancelled} · ${r.failed} failed${r.skipped > 0 ? ` · ${r.skipped} bot orders skipped` : ''}`);
        } else {
          toast.success(`Cancelled ${r.cancelled} order(s)${r.skipped > 0 ? ` (${r.skipped} bot orders skipped)` : ''}`);
        }
      },
      onError: (e) => toast.error(e.message),
    });
  };

  if (!overview) return <p className="text-muted-foreground">Loading…</p>;

  const visible = overview.balances.filter((b) => !hideZero || Number(b.fdusdValue) > 0.01);
  const top = visible.slice(0, 8);
  const otherValue = visible.slice(8).reduce((s, b) => s + Number(b.fdusdValue), 0);
  const total = Number(overview.totalFdusdValue);

  return (
    <div className="space-y-5">
      {/* Allocation donut */}
      <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <PieChart className="h-4 w-4" /> Allocation
            </CardTitle>
            <CardDescription className="text-xs">Top {top.length} of {visible.length} assets</CardDescription>
          </CardHeader>
          <CardContent>
            <DonutChart
              segments={top.map((b) => ({
                label: b.asset, value: Number(b.fdusdValue),
              })).concat(otherValue > 0 ? [{ label: 'Other', value: otherValue }] : [])}
              total={total}
            />
          </CardContent>
        </Card>

        {/* Top movers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Top movers · 24h
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TopMovers balances={visible} />
          </CardContent>
        </Card>
      </div>

      {/* Open orders strip */}
      {openOrders && openOrders.length > 0 && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Open orders ({openOrders.length})</CardTitle>
              <CardDescription className="text-xs">
                {manualCount > 0 && <>{manualCount} manual</>}
                {manualCount > 0 && botCount > 0 && <> · </>}
                {botCount > 0 && <>{botCount} bot</>}
                {manualCount + botCount === 0 && <>From bots and manual trades.</>}
              </CardDescription>
            </div>
            <div className="flex gap-2 shrink-0">
              {manualCount > 0 && (
                <Button
                  variant="outline" size="sm"
                  disabled={cancelAll.isPending}
                  onClick={() => runCancelAll(false)}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  Cancel manual ({manualCount})
                </Button>
              )}
              {botCount > 0 && (
                <Button
                  variant="destructive" size="sm"
                  disabled={cancelAll.isPending}
                  title="Includes bot orders. Bots will re-place them within ~60s."
                  onClick={() => runCancelAll(true)}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  Cancel all ({openOrders.length})
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {openOrders.map((o) => (
                <div key={o.orderId} className="flex items-center justify-between text-sm border-b last:border-0 py-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Badge variant={o.side === 'BUY' ? 'success' : 'destructive'} className="text-[9px]">{o.side}</Badge>
                    <span className="font-mono text-xs">{o.symbol}</span>
                    <span className="font-mono text-xs">
                      {formatNumber(Number(o.origQty), { maximumFractionDigits: 8 })} @ {formatNumber(Number(o.price), { maximumFractionDigits: 2 })}
                    </span>
                    {o.clientOrderId.startsWith('orca-wallet') && <Badge variant="outline" className="text-[9px]">manual</Badge>}
                    {o.clientOrderId.startsWith('orca-') && !o.clientOrderId.startsWith('orca-wallet') && (
                      <Badge variant="outline" className="text-[9px]">bot</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(new Date(o.time))}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={cancel.isPending}
                      onClick={() => cancel.mutate(
                        { apiKeyId, symbol: o.symbol, orderId: o.orderId },
                        { onSuccess: () => toast.success('Order cancelled'), onError: (e) => toast.error(e.message) },
                      )}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Balances table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle>Balances</CardTitle>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
              Hide dust
            </label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Asset</th>
                  <th className="text-right font-medium px-4 py-2">Free</th>
                  <th className="text-right font-medium px-4 py-2">Locked</th>
                  <th className="text-right font-medium px-4 py-2">Price</th>
                  <th className="text-right font-medium px-4 py-2">24h</th>
                  <th className="text-right font-medium px-4 py-2">Value</th>
                  <th className="text-right font-medium px-4 py-2">%</th>
                  <th className="text-right font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((b) => (
                  <BalanceRow
                    key={b.asset}
                    balance={b}
                    totalValue={total}
                    onTrade={() => onTrade(b.asset)}
                  />
                ))}
                {!visible.length && (
                  <tr><td colSpan={8} className="text-center text-muted-foreground py-12">No balances.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BalanceRow({ balance, totalValue, onTrade }: {
  balance: EnrichedBalance; totalValue: number; onTrade: () => void;
}) {
  const isFdusd = balance.asset === 'FDUSD';
  const value = Number(balance.fdusdValue);
  const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
  const ch = balance.change24h;
  return (
    <tr className="border-b last:border-0 hover:bg-accent/20">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
            {balance.asset.slice(0, 3)}
          </div>
          <span className="font-medium">{balance.asset}</span>
          {isFdusd && <Badge variant="secondary" className="text-[9px]">Quote</Badge>}
        </div>
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs">
        {formatNumber(balance.free, { maximumFractionDigits: 8 })}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs">
        {Number(balance.locked) > 0 ? formatNumber(balance.locked, { maximumFractionDigits: 8 }) : '—'}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs">
        {balance.fdusdPrice ? formatNumber(balance.fdusdPrice, { maximumFractionDigits: 4 }) : '—'}
      </td>
      <td className={cn('px-4 py-3 text-right font-mono text-xs',
        ch ? (ch.changePct >= 0 ? 'text-success' : 'text-destructive') : 'text-muted-foreground')}>
        {ch ? `${ch.changePct >= 0 ? '+' : ''}${ch.changePct.toFixed(2)}%` : '—'}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm">
        {value > 0 ? formatNumber(value, { maximumFractionDigits: 2 }) : '—'}
      </td>
      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
        {pct > 0.1 ? `${pct.toFixed(1)}%` : '—'}
      </td>
      <td className="px-4 py-3 text-right">
        {balance.tradeable ? (
          <div className="flex gap-1 justify-end">
            <Button variant="success" size="sm" className="h-7 px-2 text-xs" onClick={onTrade}>
              <ArrowDown className="h-3 w-3" />Buy
            </Button>
            <Button variant="destructive" size="sm" className="h-7 px-2 text-xs"
              onClick={onTrade} disabled={Number(balance.free) <= 0}>
              <ArrowUp className="h-3 w-3" />Sell
            </Button>
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground">{isFdusd ? 'quote' : 'no pair'}</span>
        )}
      </td>
    </tr>
  );
}

function DonutChart({ segments, total }: {
  segments: Array<{ label: string; value: number }>;
  total: number;
}) {
  const filtered = segments.filter((s) => s.value > 0);
  const t = filtered.reduce((s, x) => s + x.value, 0) || total || 1;
  const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#94a3b8'];
  let cum = 0;
  const segs = filtered.map((s, i) => {
    const startAngle = (cum / t) * 360;
    cum += s.value;
    const endAngle = (cum / t) * 360;
    return { ...s, startAngle, endAngle, color: COLORS[i % COLORS.length] };
  });
  const size = 180, r = 76, cx = size / 2, cy = size / 2;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-44 h-44">
        {segs.map((s, i) => {
          const a1 = (s.startAngle - 90) * Math.PI / 180;
          const a2 = (s.endAngle - 90) * Math.PI / 180;
          const x1 = cx + r * Math.cos(a1);
          const y1 = cy + r * Math.sin(a1);
          const x2 = cx + r * Math.cos(a2);
          const y2 = cy + r * Math.sin(a2);
          const large = s.endAngle - s.startAngle > 180 ? 1 : 0;
          return (
            <path key={i}
              d={`M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`}
              fill={s.color}
              opacity={0.85}>
              <title>{s.label}: {formatNumber(s.value, { maximumFractionDigits: 2 })} ({((s.value / t) * 100).toFixed(1)}%)</title>
            </path>
          );
        })}
        <circle cx={cx} cy={cy} r={r * 0.55} fill="hsl(var(--background))" />
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-current font-bold" fontSize="14">
          {formatNumber(t, { maximumFractionDigits: 0 })}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-current opacity-60" fontSize="9">FDUSD</text>
      </svg>
      <div className="flex-1 space-y-1 text-xs">
        {segs.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 truncate">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-mono text-muted-foreground">
              {((s.value / t) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopMovers({ balances }: { balances: EnrichedBalance[] }) {
  const movers = balances
    .filter((b) => b.change24h && b.tradeable && Number(b.fdusdValue) > 1)
    .sort((a, b) => Math.abs(b.change24h!.changePct) - Math.abs(a.change24h!.changePct))
    .slice(0, 6);
  if (movers.length === 0) {
    return <p className="text-xs italic text-muted-foreground">No 24h data available.</p>;
  }
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {movers.map((b) => {
        const ch = b.change24h!;
        const up = ch.changePct >= 0;
        return (
          <div key={b.asset} className="flex items-center justify-between gap-2 border rounded-md p-2.5">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm">{b.asset}</div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {formatNumber(Number(b.fdusdPrice ?? 0), { maximumFractionDigits: 4 })}
              </div>
            </div>
            <div className={cn('text-sm font-mono font-semibold flex items-center gap-0.5',
              up ? 'text-success' : 'text-destructive')}>
              {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {up ? '+' : ''}{ch.changePct.toFixed(2)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Activity tab ───

function ActivityTab({ apiKeyId }: { apiKeyId: string }) {
  const { data: deposits } = useDeposits(apiKeyId);
  const { data: withdrawals } = useWithdrawals(apiKeyId);
  const { data: trades } = useAllTrades(apiKeyId, {});
  const [exporting, setExporting] = useState(false);

  async function exportTrades() {
    setExporting(true);
    try {
      const res = await api.get(`/wallet/${apiKeyId}/export/trades.csv`, { responseType: 'blob' });
      const blob = new Blob([res.data]);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `wallet-trades-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('Trades CSV downloaded');
    } catch (e: unknown) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setExporting(false); }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowDownToLine className="h-4 w-4 text-success" /> Deposits
              <Badge variant="outline" className="text-[10px]">{deposits?.length ?? 0}</Badge>
            </CardTitle>
            <CardDescription className="text-xs">From Binance (last 90 days).</CardDescription>
          </CardHeader>
          <CardContent className="p-0 max-h-[400px] overflow-y-auto">
            {!deposits?.length ? (
              <p className="p-3 text-xs italic text-muted-foreground">No deposits in last 90 days.</p>
            ) : (
              deposits.map((d, i) => (
                <div key={i} className="px-3 py-2 border-b last:border-0 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium">
                      +{formatNumber(d.amount, { maximumFractionDigits: 8 })} {d.coin}
                    </span>
                    <Badge variant={d.status === 1 ? 'success' : 'outline'} className="text-[9px]">
                      {d.status === 1 ? 'completed' : d.status === 0 ? 'pending' : 'credited'}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {d.network} · {new Date(d.insertTime).toLocaleString()}
                  </div>
                  {d.txId && (
                    <div className="text-[10px] text-muted-foreground font-mono truncate">tx: {d.txId}</div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowUpFromLine className="h-4 w-4 text-destructive" /> Withdrawals
              <Badge variant="outline" className="text-[10px]">{withdrawals?.length ?? 0}</Badge>
            </CardTitle>
            <CardDescription className="text-xs">From Binance (last 90 days).</CardDescription>
          </CardHeader>
          <CardContent className="p-0 max-h-[400px] overflow-y-auto">
            {!withdrawals?.length ? (
              <p className="p-3 text-xs italic text-muted-foreground">No withdrawals in last 90 days.</p>
            ) : (
              withdrawals.map((w, i) => (
                <div key={i} className="px-3 py-2 border-b last:border-0 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium">
                      −{formatNumber(w.amount, { maximumFractionDigits: 8 })} {w.coin}
                    </span>
                    <Badge variant={w.status === 6 ? 'success' : 'outline'} className="text-[9px]">
                      {withdrawalStatusLabel(w.status)}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {w.network} · fee {w.transactionFee} · {new Date(w.applyTime).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trades */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Recent trades (all symbols)
              <Badge variant="outline" className="text-[10px]">{trades?.length ?? 0}</Badge>
            </CardTitle>
            <CardDescription className="text-xs">From bots + manual wallet trades.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={exportTrades} disabled={exporting}>
            <Download className="h-3.5 w-3.5 mr-1" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-[10px] uppercase text-muted-foreground sticky top-0 bg-background">
                <tr>
                  <th className="text-left px-3 py-2">Time</th>
                  <th className="text-left px-3 py-2">Symbol</th>
                  <th className="text-left px-3 py-2">Side</th>
                  <th className="text-right px-3 py-2">Price</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-right px-3 py-2">Quote</th>
                  <th className="text-right px-3 py-2">Fee</th>
                </tr>
              </thead>
              <tbody>
                {trades?.map((t) => (
                  <tr key={`${t.symbol}-${t.id}`} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                      {formatRelativeTime(new Date(t.time))}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">{t.symbol}</td>
                    <td className="px-3 py-1.5">
                      <Badge variant={t.isBuyer ? 'success' : 'destructive'} className="text-[9px]">
                        {t.isBuyer ? 'BUY' : 'SELL'}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(t.price, { maximumFractionDigits: 4 })}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(t.qty, { maximumFractionDigits: 6 })}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(t.quoteQty, { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-1.5 text-right text-[10px] text-muted-foreground font-mono">
                      {Number(t.commission) > 0 ? `${formatNumber(t.commission, { maximumFractionDigits: 6 })} ${t.commissionAsset}` : '—'}
                    </td>
                  </tr>
                ))}
                {!trades?.length && (
                  <tr><td colSpan={7} className="p-6 text-center text-xs italic text-muted-foreground">No trades.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function withdrawalStatusLabel(s: number): string {
  return ['Email Sent', 'Cancelled', 'Awaiting Approval', 'Rejected', 'Processing', 'Failure', 'Completed'][s] ?? 'Unknown';
}

// ─── Performance tab ───

function PerformanceTab({ apiKeyId }: { apiKeyId: string }) {
  const { data: snapshots } = useSnapshots(apiKeyId, 30);
  const { data: costBasis } = useCostBasis(apiKeyId);
  const snapshotNow = useSnapshotNow();

  return (
    <div className="space-y-5">
      {/* Equity curve */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Portfolio value · 30 days
            </CardTitle>
            <CardDescription className="text-xs">
              Auto-snapshotted (manual capture available).
            </CardDescription>
          </div>
          <Button size="sm" variant="outline"
            disabled={snapshotNow.isPending}
            onClick={() => snapshotNow.mutate(apiKeyId, {
              onSuccess: () => toast.success('Snapshot captured'),
              onError: (e) => toast.error(e.message),
            })}>
            <Camera className="h-3.5 w-3.5 mr-1" />
            {snapshotNow.isPending ? 'Capturing…' : 'Snapshot now'}
          </Button>
        </CardHeader>
        <CardContent>
          {!snapshots?.length ? (
            <p className="text-xs italic text-muted-foreground">
              No snapshots yet. Click "Snapshot now" to capture today's value, or wait for the scheduler.
            </p>
          ) : (
            <EquityCurveChart points={snapshots} />
          )}
        </CardContent>
      </Card>

      {/* Cost basis per asset */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" /> Cost basis & P&L per asset
          </CardTitle>
          <CardDescription className="text-xs">
            Avg buy price + realized + unrealized P&L, reconstructed from Binance trade history.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Asset</th>
                  <th className="text-right px-3 py-2">Held</th>
                  <th className="text-right px-3 py-2">Avg Buy</th>
                  <th className="text-right px-3 py-2">Current</th>
                  <th className="text-right px-3 py-2">Unrealized</th>
                  <th className="text-right px-3 py-2">Realized</th>
                  <th className="text-right px-3 py-2">Held Value</th>
                </tr>
              </thead>
              <tbody>
                {costBasis?.map((c) => {
                  const unrealPct = c.avgBuyPrice ? ((c.currentPrice - c.avgBuyPrice) / c.avgBuyPrice) * 100 : null;
                  return (
                    <tr key={c.asset} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{c.asset}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {formatNumber(c.heldQty, { maximumFractionDigits: 6 })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {c.avgBuyPrice ? formatNumber(c.avgBuyPrice, { maximumFractionDigits: 4 }) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {formatNumber(c.currentPrice, { maximumFractionDigits: 4 })}
                      </td>
                      <td className={cn('px-3 py-2 text-right font-mono text-xs',
                        c.unrealizedPnl === null ? 'text-muted-foreground'
                        : c.unrealizedPnl >= 0 ? 'text-success' : 'text-destructive')}>
                        {c.unrealizedPnl !== null
                          ? `${c.unrealizedPnl >= 0 ? '+' : ''}${formatNumber(c.unrealizedPnl, { maximumFractionDigits: 2 })}`
                          : '—'}
                        {unrealPct !== null && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            ({unrealPct >= 0 ? '+' : ''}{unrealPct.toFixed(1)}%)
                          </span>
                        )}
                      </td>
                      <td className={cn('px-3 py-2 text-right font-mono text-xs',
                        c.realizedPnl >= 0 ? 'text-success' : 'text-destructive')}>
                        {c.realizedPnl >= 0 ? '+' : ''}{formatNumber(c.realizedPnl, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-sm font-semibold">
                        {formatNumber(c.heldValue, { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })}
                {!costBasis?.length && (
                  <tr><td colSpan={7} className="p-6 text-center text-xs italic text-muted-foreground">No held assets yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EquityCurveChart({ points }: { points: Array<{ ts: number; value: number }> }) {
  if (points.length < 2) {
    return <p className="text-xs italic text-muted-foreground">Need ≥ 2 snapshots to draw a curve.</p>;
  }
  const w = 700, h = 180, pad = 12;
  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.value);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const xR = maxX - minX || 1, yR = maxY - minY || 1;
  const toX = (t: number) => pad + ((t - minX) / xR) * (w - 2 * pad);
  const toY = (v: number) => h - pad - ((v - minY) / yR) * (h - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.ts).toFixed(1)} ${toY(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1].value;
  const first = points[0].value;
  const tone = last >= first ? '#22c55e' : '#ef4444';
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1 text-xs">
        <span className="text-muted-foreground">
          {new Date(minX).toLocaleDateString()} → {new Date(maxX).toLocaleDateString()}
        </span>
        <span className={cn('font-mono', last >= first ? 'text-success' : 'text-destructive')}>
          {last >= first ? '+' : ''}{formatNumber(last - first, { maximumFractionDigits: 2 })}
          <span className="text-muted-foreground ml-1">
            ({first > 0 ? (((last - first) / first) * 100).toFixed(2) : '—'}%)
          </span>
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
        <path d={path} fill="none" stroke={tone} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={toX(maxX)} cy={toY(last)} r="3" fill={tone} />
      </svg>
    </div>
  );
}

// ─── Tools tab ───

function ToolsTab({ apiKeyId, balances }: { apiKeyId: string; balances: EnrichedBalance[] }) {
  const dust = balances.filter((b) =>
    Number(b.fdusdValue) > 0 && Number(b.fdusdValue) < 10
    && b.asset !== 'FDUSD' && b.asset !== 'BNB' && b.tradeable,
  );
  const convertDust = useConvertDust();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = dust.length > 0 && dust.every((d) => selected.has(d.asset));

  const totalDustValue = dust
    .filter((d) => selected.has(d.asset))
    .reduce((s, d) => s + Number(d.fdusdValue), 0);

  return (
    <div className="space-y-5">
      {/* Dust converter */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="h-4 w-4" /> Convert dust to BNB
          </CardTitle>
          <CardDescription className="text-xs">
            Convert small balances (&lt; 10 FDUSD value) into BNB. Binance applies its standard service fee.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dust.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No dust balances to convert.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(dust.map((d) => d.asset)))}
                  />
                  Select all ({dust.length})
                </label>
                <span className="ml-auto text-muted-foreground">
                  Selected: <span className="font-mono">{formatNumber(totalDustValue, { maximumFractionDigits: 2 })} FDUSD</span>
                </span>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2 max-h-[280px] overflow-y-auto">
                {dust.map((d) => (
                  <label key={d.asset} className="flex items-center justify-between gap-2 border rounded-md px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/30">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(d.asset)}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(d.asset)) next.delete(d.asset); else next.add(d.asset);
                          setSelected(next);
                        }}
                      />
                      <span className="font-medium">{d.asset}</span>
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {formatNumber(Number(d.fdusdValue), { maximumFractionDigits: 2 })} FDUSD
                    </span>
                  </label>
                ))}
              </div>
              <Button
                className="mt-3"
                size="sm"
                disabled={convertDust.isPending || selected.size === 0}
                onClick={() => {
                  if (!confirm(`Convert ${selected.size} asset(s) to BNB? Binance charges a small service fee.`)) return;
                  convertDust.mutate(
                    { apiKeyId, assets: [...selected] },
                    {
                      onSuccess: (r) => {
                        toast.success(`Converted to ${r.totalTransfered} BNB (fee: ${r.totalServiceCharge})`);
                        setSelected(new Set());
                      },
                      onError: (e) => toast.error(e.message),
                    },
                  );
                }}>
                <Coins className="h-3.5 w-3.5 mr-1" />
                {convertDust.isPending ? 'Converting…' : `Convert ${selected.size} asset(s)`}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Price alerts */}
      <PriceAlertsCard balances={balances} />
    </div>
  );
}

function PriceAlertsCard({ balances }: { balances: EnrichedBalance[] }) {
  const { data: alerts } = usePriceAlerts();
  const create = useCreateAlert();
  const toggleAlert = useToggleAlert();
  const del = useDeleteAlert();
  const [showForm, setShowForm] = useState(false);
  const [asset, setAsset] = useState('');
  const [direction, setDirection] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [threshold, setThreshold] = useState('');
  const [note, setNote] = useState('');

  const tradeableAssets = useMemo(
    () => balances.filter((b) => b.tradeable).map((b) => b.asset),
    [balances],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!asset || !threshold) return;
    create.mutate(
      { symbol: `${asset}FDUSD`, asset, direction, threshold: Number(threshold), note: note || undefined },
      {
        onSuccess: () => {
          toast.success('Alert created');
          setShowForm(false); setAsset(''); setThreshold(''); setNote('');
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" /> Price alerts
            <Badge variant="outline" className="text-[10px]">{alerts?.length ?? 0}</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Get notified when an asset crosses a price threshold.
          </CardDescription>
        </div>
        {!showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>+ New alert</Button>
        )}
      </CardHeader>
      <CardContent>
        {showForm && (
          <form onSubmit={submit} className="space-y-3 mb-4 border rounded-md p-3 bg-muted/20">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label className="text-xs">Asset</Label>
                <select
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm mt-1"
                  value={asset} onChange={(e) => setAsset(e.target.value)} required>
                  <option value="">Select asset…</option>
                  {tradeableAssets.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Direction</Label>
                <select
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm mt-1"
                  value={direction} onChange={(e) => setDirection(e.target.value as 'ABOVE' | 'BELOW')}>
                  <option value="ABOVE">Price ABOVE</option>
                  <option value="BELOW">Price BELOW</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Threshold (FDUSD)</Label>
                <Input type="number" step="any" min="0" value={threshold}
                  onChange={(e) => setThreshold(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label className="text-xs">Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. buy zone, stop-loss target" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create alert'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        )}

        {!alerts?.length && !showForm ? (
          <p className="text-xs italic text-muted-foreground">No alerts. Set one to be notified on price moves.</p>
        ) : (
          <div className="space-y-1.5">
            {alerts?.map((a) => {
              const triggered = !!a.triggeredAt;
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 border rounded-md p-2.5 text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge variant={triggered ? 'success' : 'outline'} className="text-[9px]">
                      {triggered ? 'triggered' : a.enabled ? 'active' : 'paused'}
                    </Badge>
                    <span className="font-medium">{a.asset}</span>
                    <span className="text-muted-foreground">{a.direction === 'ABOVE' ? '≥' : '≤'}</span>
                    <span className="font-mono">{formatNumber(Number(a.threshold), { maximumFractionDigits: 4 })}</span>
                    {a.note && <span className="text-[10px] text-muted-foreground italic truncate">— {a.note}</span>}
                    {triggered && a.triggeredPrice && (
                      <span className="text-[10px] text-muted-foreground">
                        (triggered @ {formatNumber(Number(a.triggeredPrice))}, {formatRelativeTime(a.triggeredAt!)})
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost"
                      onClick={() => toggleAlert.mutate({ id: a.id, enabled: !a.enabled })}>
                      {a.enabled ? 'Pause' : 'Resume'}
                    </Button>
                    <Button size="sm" variant="ghost"
                      onClick={() => {
                        if (!confirm('Delete alert?')) return;
                        del.mutate(a.id);
                      }}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
