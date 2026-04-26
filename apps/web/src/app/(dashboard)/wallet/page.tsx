'use client';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, RefreshCw, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { useExchangeKeys } from '@/lib/queries';
import {
  useWalletOverview,
  useOpenOrders,
  useCancelWalletOrder,
  type WalletBalance,
} from '@/lib/queries-wallet';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TradeModal } from '@/components/trade-modal';
import { formatNumber, formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export default function WalletPage() {
  const { data: keys } = useExchangeKeys();
  const activeKeys = keys?.filter((k) => k.status === 'ACTIVE') ?? [];
  const [apiKeyId, setApiKeyId] = useState<string | undefined>();
  const [tradingAsset, setTradingAsset] = useState<string | null>(null);
  const [hideZero, setHideZero] = useState(true);

  // Auto-select first active key
  useEffect(() => {
    if (!apiKeyId && activeKeys.length) setApiKeyId(activeKeys[0]!.id);
  }, [activeKeys, apiKeyId]);

  const { data: overview, isFetching, refetch } = useWalletOverview(apiKeyId);
  const { data: openOrders } = useOpenOrders(apiKeyId);
  const cancel = useCancelWalletOrder();

  const fdusdBalance = overview?.balances.find((b) => b.asset === 'FDUSD');
  const tradingBalance = overview?.balances.find((b) => b.asset === tradingAsset);

  const visibleBalances = (overview?.balances ?? []).filter((b) =>
    !hideZero || Number(b.fdusdValue) > 0.01,
  );

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
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" />
            Wallet
          </h1>
          <p className="text-muted-foreground">View balances and trade directly against FDUSD.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={apiKeyId ?? ''}
            onChange={(e) => setApiKeyId(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {activeKeys.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <Button variant="outline" size="icon" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Total value */}
      <Card className="bg-gradient-to-br from-primary/10 to-accent/30 border-primary/30">
        <CardContent className="p-6">
          <div className="text-sm text-muted-foreground mb-1">Total portfolio value</div>
          <div className="text-4xl font-bold flex items-baseline gap-2">
            <span>{formatNumber(overview?.totalFdusdValue ?? 0, { maximumFractionDigits: 2 })}</span>
            <span className="text-base text-muted-foreground font-normal">FDUSD</span>
          </div>
          <div className="text-xs text-muted-foreground mt-2 flex gap-4">
            <span>{overview?.assetCount ?? 0} assets</span>
            <span>{overview?.tradeableCount ?? 0} tradeable on FDUSD</span>
          </div>
        </CardContent>
      </Card>

      {/* Open orders strip */}
      {openOrders && openOrders.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Open orders ({openOrders.length})</CardTitle>
            <CardDescription>From bots and manual trades.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {openOrders.map((o) => (
                <div key={o.orderId} className="flex items-center justify-between text-sm border-b last:border-b-0 py-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Badge variant={o.side === 'BUY' ? 'success' : 'destructive'} className="text-[9px]">{o.side}</Badge>
                    <span className="font-mono text-xs">{o.symbol}</span>
                    <span className="font-mono text-xs">{formatNumber(Number(o.origQty), { maximumFractionDigits: 8 })} @ {formatNumber(Number(o.price), { maximumFractionDigits: 2 })}</span>
                    {o.clientOrderId.startsWith('orca-wallet') && <Badge variant="outline" className="text-[9px]">manual</Badge>}
                    {o.clientOrderId.startsWith('orca-') && !o.clientOrderId.startsWith('orca-wallet') && <Badge variant="outline" className="text-[9px]">bot</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(new Date(o.time))}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={cancel.isPending}
                      onClick={() => cancel.mutate(
                        { apiKeyId: apiKeyId!, symbol: o.symbol, orderId: o.orderId },
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

      {/* Balances */}
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
                  <th className="text-right font-medium px-4 py-2">Price (FDUSD)</th>
                  <th className="text-right font-medium px-4 py-2">Value</th>
                  <th className="text-right font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleBalances.map((b) => (
                  <BalanceRow
                    key={b.asset}
                    balance={b}
                    onTrade={() => setTradingAsset(b.asset)}
                  />
                ))}
                {!visibleBalances.length && (
                  <tr><td colSpan={6} className="text-center text-muted-foreground py-12">No balances.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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

function BalanceRow({ balance, onTrade }: { balance: WalletBalance; onTrade: () => void }) {
  const isFdusd = balance.asset === 'FDUSD';
  return (
    <tr className="border-b last:border-b-0 hover:bg-accent/20">
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
      <td className="px-4 py-3 text-right font-mono text-sm">
        {Number(balance.fdusdValue) > 0
          ? formatNumber(balance.fdusdValue, { maximumFractionDigits: 2 })
          : '—'}
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
          <span className="text-[10px] text-muted-foreground">{isFdusd ? 'quote' : 'no FDUSD pair'}</span>
        )}
      </td>
    </tr>
  );
}
