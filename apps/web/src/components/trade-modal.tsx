'use client';
import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useSymbolInfo, useWalletTrade, type WalletBalance } from '@/lib/queries-wallet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface Props {
  apiKeyId: string;
  asset: string;
  balance: WalletBalance;
  fdusdBalance?: WalletBalance;
  onClose: () => void;
}

const QUOTE = 'FDUSD';

export function TradeModal({ apiKeyId, asset, balance, fdusdBalance, onClose }: Props) {
  const symbol = `${asset}${QUOTE}`;
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('');
  const [percentage, setPercentage] = useState(0);

  const { data: info } = useSymbolInfo(apiKeyId, symbol);
  const trade = useWalletTrade();
  const lastPrice = info?.price ? Number(info.price) : 0;

  // Auto-fill price for limit orders when ticker arrives
  useEffect(() => {
    if (info?.price && !price) setPrice(info.price);
  }, [info?.price, price]);

  const effectivePrice = orderType === 'market' ? lastPrice : Number(price || lastPrice);

  // Available for this side
  const available = side === 'BUY'
    ? Number(fdusdBalance?.free ?? 0)
    : Number(balance.free);
  const availableLabel = side === 'BUY' ? QUOTE : asset;

  // Quick percentage buttons
  const onPercent = (pct: number) => {
    setPercentage(pct);
    if (side === 'BUY') {
      const q = (available * pct) / 100;
      setQuoteAmount(q.toFixed(2));
      setQuantity(effectivePrice > 0 ? (q / effectivePrice).toFixed(8) : '');
    } else {
      const q = (available * pct) / 100;
      setQuantity(q.toFixed(8));
      setQuoteAmount(effectivePrice > 0 ? (q * effectivePrice).toFixed(2) : '');
    }
  };

  // Sync quantity ↔ quoteAmount when one changes
  useEffect(() => {
    if (!effectivePrice) return;
    if (quantity && !quoteAmount) {
      setQuoteAmount((Number(quantity) * effectivePrice).toFixed(2));
    }
  }, [quantity, effectivePrice, quoteAmount]);

  const submit = () => {
    if (!quantity && !quoteAmount) return toast.error('Enter quantity or amount');
    trade.mutate(
      {
        apiKeyId,
        symbol,
        side,
        ...(orderType === 'limit' && price ? { price: Number(price) } : {}),
        ...(quantity ? { quantity: Number(quantity) } : { quoteAmount: Number(quoteAmount) }),
      },
      {
        onSuccess: (r) => {
          toast.success(`${side} order placed: ${r.origQty} @ ${r.price} (${r.status})`);
          onClose();
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const minNotional = info ? Number(info.filters.minNotional) : 0;
  const currentNotional = Number(quoteAmount || (Number(quantity) * effectivePrice));
  const belowMin = minNotional > 0 && currentNotional > 0 && currentNotional < minNotional;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md animate-slide-in">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <span>{asset}/{QUOTE}</span>
                {info && <Badge variant="outline" className="font-mono text-xs">${formatNumber(lastPrice, { maximumFractionDigits: 2 })}</Badge>}
              </CardTitle>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Side toggle */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-md">
              <button
                onClick={() => { setSide('BUY'); setQuantity(''); setQuoteAmount(''); setPercentage(0); }}
                className={cn(
                  'py-2 rounded text-sm font-medium transition-colors',
                  side === 'BUY' ? 'bg-success text-success-foreground' : 'hover:bg-background',
                )}
              >
                BUY {asset}
              </button>
              <button
                onClick={() => { setSide('SELL'); setQuantity(''); setQuoteAmount(''); setPercentage(0); }}
                className={cn(
                  'py-2 rounded text-sm font-medium transition-colors',
                  side === 'SELL' ? 'bg-destructive text-destructive-foreground' : 'hover:bg-background',
                )}
              >
                SELL {asset}
              </button>
            </div>

            {/* Order type */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-md">
              <button
                onClick={() => setOrderType('market')}
                className={cn(
                  'py-1.5 rounded text-xs font-medium transition-colors',
                  orderType === 'market' ? 'bg-primary text-primary-foreground' : 'hover:bg-background',
                )}
              >
                Market (instant)
              </button>
              <button
                onClick={() => setOrderType('limit')}
                className={cn(
                  'py-1.5 rounded text-xs font-medium transition-colors',
                  orderType === 'limit' ? 'bg-primary text-primary-foreground' : 'hover:bg-background',
                )}
              >
                Limit
              </button>
            </div>

            {orderType === 'limit' && (
              <div className="space-y-1">
                <Label className="text-xs">Limit price ({QUOTE})</Label>
                <Input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
            )}

            {/* Available */}
            <div className="text-xs text-muted-foreground flex justify-between">
              <span>Available: {formatNumber(available, { maximumFractionDigits: 8 })} {availableLabel}</span>
            </div>

            {/* Amount inputs */}
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Amount ({asset})</Label>
                <Input
                  type="number" step="any" placeholder="0.00"
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    setQuoteAmount(effectivePrice ? (Number(e.target.value) * effectivePrice).toFixed(2) : '');
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total ({QUOTE})</Label>
                <Input
                  type="number" step="any" placeholder="0.00"
                  value={quoteAmount}
                  onChange={(e) => {
                    setQuoteAmount(e.target.value);
                    setQuantity(effectivePrice ? (Number(e.target.value) / effectivePrice).toFixed(8) : '');
                  }}
                />
              </div>
            </div>

            {/* Percent shortcuts */}
            <div className="grid grid-cols-4 gap-1">
              {[25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  onClick={() => onPercent(p)}
                  className={cn(
                    'py-1.5 text-xs rounded border transition-colors',
                    percentage === p ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent',
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>

            {/* Validation hint */}
            {belowMin && (
              <p className="text-xs text-destructive">
                Order notional ({currentNotional.toFixed(2)}) below Binance minimum ({minNotional}).
              </p>
            )}

            {/* Summary */}
            {currentNotional > 0 && (
              <div className="rounded-md bg-muted p-3 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Side</span><span>{side}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>LIMIT @ {orderType === 'market' ? formatNumber(effectivePrice, { maximumFractionDigits: 2 }) + ' (current)' : price}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span>{quantity || '—'} {asset}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span>{quoteAmount || '—'} {QUOTE}</span></div>
                <div className="flex justify-between text-success"><span>Fee</span><span>0 ({QUOTE} pair)</span></div>
              </div>
            )}

            <Button
              variant={side === 'BUY' ? 'success' : 'destructive'}
              className="w-full"
              disabled={trade.isPending || (!quantity && !quoteAmount) || belowMin}
              onClick={submit}
            >
              {trade.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {side} {asset}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
