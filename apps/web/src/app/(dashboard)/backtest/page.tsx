'use client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { useBacktest } from '@/lib/queries-v2';
import { useStrategies } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';

interface FormData {
  strategyId: string;
  symbol: string;
  interval: string;
  days: number;
  upperPrice?: number;
  lowerPrice?: number;
  gridLevels?: number;
  totalQuoteInvestment?: number;
  spacingMode?: 'arithmetic' | 'geometric';
  priceMultiplier?: number;
  cooldownSec?: number;
}

export default function BacktestPage() {
  const backtest = useBacktest();
  const { data: strategies } = useStrategies();

  const { register, handleSubmit, watch, setValue } = useForm<FormData>({
    defaultValues: {
      symbol: 'BTCFDUSD',
      interval: '1h',
      days: 30,
      gridLevels: 15,
      spacingMode: 'geometric',
      cooldownSec: 60,
    },
  });

  useEffect(() => {
    const grid = strategies?.find((s) => s.builtinKey === 'grid_v1');
    if (grid && !watch('strategyId')) setValue('strategyId', grid.id);
  }, [strategies, setValue, watch]);

  const selectedId = watch('strategyId');
  const selected = strategies?.find((s) => s.id === selectedId);
  const isGrid = selected?.type === 'GRID';
  const isGraph = selected?.type === 'CUSTOM';

  const onSubmit = (data: FormData) => {
    if (!data.strategyId) return toast.error('Please select a strategy');
    const params: Record<string, unknown> = {};
    if (isGrid) {
      Object.assign(params, {
        upperPrice: Number(data.upperPrice),
        lowerPrice: Number(data.lowerPrice),
        gridLevels: Number(data.gridLevels),
        totalQuoteInvestment: Number(data.totalQuoteInvestment),
        spacingMode: data.spacingMode,
      });
      if (data.priceMultiplier) params.priceMultiplier = Number(data.priceMultiplier);
    } else if (isGraph) {
      params.cooldownSec = Number(data.cooldownSec ?? 60);
    }
    backtest.mutate(
      {
        strategyId: data.strategyId,
        symbol: data.symbol.toUpperCase(),
        interval: data.interval,
        days: Number(data.days),
        params,
      },
      { onError: (e) => toast.error(e.message) },
    );
  };

  const result = backtest.data;
  const equityCurve = result?.trades.map((t, i) => ({
    i,
    pnl: result.trades.slice(0, i + 1).reduce((s, x) => s + x.pnl, 0),
  }));

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold">Backtest</h1>
        <p className="text-muted-foreground">Test any strategy against historical Binance data.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Setup</CardTitle>
            <CardDescription>Select a strategy and configure the run.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <Field label="Strategy">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  {...register('strategyId', { required: true })}>
                  <option value="">— Select —</option>
                  {strategies?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type})
                    </option>
                  ))}
                </select>
                {selected && (
                  <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                    <Badge variant={selected.visibility === 'BUILTIN' ? 'default' : 'outline'} className="text-[9px]">
                      {selected.visibility}
                    </Badge>
                    <span className="truncate">{selected.description}</span>
                  </div>
                )}
              </Field>

              <Field label="Symbol"><Input {...register('symbol', { required: true })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Interval">
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" {...register('interval')}>
                    <option value="1m">1m</option><option value="5m">5m</option>
                    <option value="15m">15m</option><option value="1h">1h</option>
                    <option value="4h">4h</option><option value="1d">1d</option>
                  </select>
                </Field>
                <Field label="Days back">
                  <Input type="number" min={1} max={180} {...register('days', { valueAsNumber: true })} />
                </Field>
              </div>

              {isGrid && (
                <>
                  <div className="pt-2 text-xs uppercase font-semibold text-muted-foreground">Grid params</div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Lower"><Input type="number" step="any" {...register('lowerPrice', { valueAsNumber: true })} /></Field>
                    <Field label="Upper"><Input type="number" step="any" {...register('upperPrice', { valueAsNumber: true })} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Levels"><Input type="number" min={2} max={200} {...register('gridLevels', { valueAsNumber: true })} /></Field>
                    <Field label="Investment"><Input type="number" step="any" {...register('totalQuoteInvestment', { valueAsNumber: true })} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Spacing">
                      <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" {...register('spacingMode')}>
                        <option value="geometric">Geometric</option>
                        <option value="arithmetic">Arithmetic</option>
                      </select>
                    </Field>
                    <Field label="Multiplier">
                      <Input type="number" step="any" placeholder="auto" {...register('priceMultiplier', { valueAsNumber: true })} />
                    </Field>
                  </div>
                </>
              )}

              {isGraph && (
                <>
                  <div className="pt-2 text-xs uppercase font-semibold text-muted-foreground">Graph params</div>
                  <Field label="Cooldown between actions (seconds)">
                    <Input type="number" min={1} max={86400} {...register('cooldownSec', { valueAsNumber: true })} />
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    Simulated wallet starts with $1,000 quote. Buy actions consume quote; sells release it.
                  </p>
                </>
              )}

              <Button type="submit" className="w-full" disabled={backtest.isPending || !selected}>
                {backtest.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Run Backtest
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          {result ? (
            <>
              <Card>
                <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                  <Badge variant="default">{result.engine}</Badge>
                  <span className="font-medium">{result.strategyName}</span>
                  <span className="text-xs text-muted-foreground">on {result.symbol} · {result.bars} bars</span>
                </CardContent>
              </Card>

              <div className="grid grid-cols-3 gap-3">
                <Stat label="Trades" value={String(result.stats.totalTrades)} />
                <Stat label="Final P&L" value={formatNumber(result.stats.finalPnl)} accent={result.stats.finalPnl >= 0 ? 'success' : 'destructive'} />
                <Stat label="ROI" value={`${result.stats.roi.toFixed(2)}%`} accent={result.stats.roi >= 0 ? 'success' : 'destructive'} />
                <Stat label="Buys" value={String(result.stats.buys)} />
                <Stat label="Sells" value={String(result.stats.sells)} />
                <Stat label="Max DD" value={formatNumber(result.stats.maxDrawdown)} />
                {result.stats.winRate !== undefined && (
                  <Stat label="Win Rate" value={`${result.stats.winRate.toFixed(1)}%`} />
                )}
              </div>

              <Card>
                <CardHeader><CardTitle>Equity Curve</CardTitle></CardHeader>
                <CardContent>
                  {equityCurve?.length ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={equityCurve}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="i" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                        <Line type="monotone" dataKey="pnl" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-muted-foreground py-12 text-center">No trades simulated.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Recent Trades</CardTitle></CardHeader>
                <CardContent className="max-h-[400px] overflow-y-auto">
                  {result.trades.slice(-30).reverse().map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-sm border-b py-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={t.side === 'BUY' ? 'success' : 'destructive'} className="text-[10px]">{t.side}</Badge>
                        <span className="font-mono">{formatNumber(t.qty)} @ {formatNumber(t.price)}</span>
                      </div>
                      {t.pnl !== 0 && (
                        <span className={t.pnl >= 0 ? 'text-success' : 'text-destructive'}>
                          {formatNumber(t.pnl, { signDisplay: 'always' })}
                        </span>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                Select a strategy on the left and run a backtest.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'success' | 'destructive' }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${accent === 'success' ? 'text-success' : accent === 'destructive' ? 'text-destructive' : ''}`}>{value}</div>
    </CardContent></Card>
  );
}
