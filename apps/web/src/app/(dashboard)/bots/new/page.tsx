'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useStrategies, useExchangeKeys, useCreateBot, useAssetBalance } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BotPreview, type PreviewLevel } from '@/components/bot-preview';
import Link from 'next/link';

interface FormData {
  name: string;
  strategyId: string;
  apiKeyId: string;
  symbol: string;
  // Grid v2 (simplified UX)
  gridLevels?: number;
  totalQuoteInvestment?: number;
  /** UI: 'percent' = % gap between adjacent levels, 'dollar' = exact $ gap */
  gridSpacingType?: 'percent' | 'dollar';
  /** UI: the % or $ gap value */
  gridSpacingValue?: number;
  /** UI: when true, anchor uses live ticker (anchorPrice ignored) */
  useMarketPrice?: boolean;
  anchorPrice?: number;
  orderSizeMultiplier?: number;
  gridMode?: 'long' | 'short' | 'neutral';
  initialPositionPct?: number;
  useExistingInventory?: boolean;
  existingInventoryPct?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  trailingStopPct?: number;
  stopAfterCycles?: number;
  // Graph
  cooldownSec?: number;
  // DCA
  dcaDirection?: 'BUY' | 'SELL';
  totalOrders?: number;
  intervalMinutes?: number;
  enableTimeGate?: boolean;
  enablePriceGate?: boolean;
  priceGateMode?: 'pct' | 'dollar';
  minPriceMovePct?: number;
  minPriceMoveDollar?: number;
  takeProfitPct?: number;
  stopLossPct?: number;
  // MA Cross
  fastPeriod?: number;
  slowPeriod?: number;
  quoteAmountPerTrade?: number;
  // GridSimple (x2-style)
  gsGridLevels?: number;
  gsGridSpread?: number;
  gsOrderSize?: number;
  gsDurationMinutes?: number;
  gsUseCustomStartPrice?: boolean;
  gsCustomStartPrice?: number;
  // DcaSimple (x2-style ladder DCA)
  dsDirection?: 'BUY' | 'SELL';
  dsGridLevels?: number;
  dsGridSpread?: number;
  dsOrderSize?: number;
  dsTakeProfit?: number;
  dsPriceMultiplierMode?: 'flat' | 'percent' | 'dollar';
  dsPriceMultiplier?: number;
  dsSizeMultiplierMode?: 'flat' | 'percent' | 'dollar';
  dsSizeMultiplier?: number;
  dsCooldownMinutes?: number;
  dsRecenterAfterMinutes?: number;
  dsDurationMinutes?: number;
  dsUseCustomStartPrice?: boolean;
  dsCustomStartPrice?: number;
  // Common risk
  paperTrading?: boolean;
  dailyLossLimit?: number;
  maxDrawdownPct?: number;
}

export default function NewBotPage() {
  const router = useRouter();
  const search = useSearchParams();
  const presetStrategyId = search.get('strategyId');

  const { data: strategies } = useStrategies();
  const { data: keys } = useExchangeKeys();
  const create = useCreateBot();

  const activeKeys = keys?.filter((k) => k.status === 'ACTIVE') ?? [];
  const selectedStrategy = strategies?.find((s) => s.id === presetStrategyId)
    ?? strategies?.find((s) => s.builtinKey === 'grid_v1');
  const builtinKey = selectedStrategy?.builtinKey;
  const isGrid = builtinKey === 'grid_v1';
  const isGridSimple = builtinKey === 'grid_simple';
  const isDCA = builtinKey === 'dca_v1';
  const isDcaSimple = builtinKey === 'dca_simple';
  const isMACross = builtinKey === 'ma_cross_v1';
  const isGraph = selectedStrategy?.type === 'CUSTOM' && !isMACross;

  const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<FormData>({
    defaultValues: {
      symbol: 'BTCFDUSD',
      gridLevels: 10,
      gridSpacingType: 'percent',
      gridSpacingValue: 1,
      useMarketPrice: true,
      gridMode: 'long',
      orderSizeMultiplier: 1,
      gsGridLevels: 20,
      gsGridSpread: 10,
      gsOrderSize: 10,
      gsDurationMinutes: 0,
      gsUseCustomStartPrice: false,
      dsDirection: 'BUY',
      dsGridLevels: 20,
      dsGridSpread: 10,
      dsOrderSize: 10,
      dsTakeProfit: 50,
      dsPriceMultiplierMode: 'flat',
      dsPriceMultiplier: 0,
      dsSizeMultiplierMode: 'flat',
      dsSizeMultiplier: 0,
      dsCooldownMinutes: 0,
      dsRecenterAfterMinutes: 0,
      dsDurationMinutes: 0,
      dsUseCustomStartPrice: false,
      cooldownSec: 60,
      dcaDirection: 'BUY',
      totalOrders: 20,
      intervalMinutes: 60,
      enableTimeGate: true,
      enablePriceGate: false,
    },
  });

  // Auto-select strategy
  useEffect(() => {
    if (selectedStrategy) setValue('strategyId', selectedStrategy.id);
  }, [selectedStrategy, setValue]);

  // Auto-default totalQuoteInvestment from FDUSD balance when API key changes
  const watchedKey = watch('apiKeyId');
  const watchedSymbol = watch('symbol') ?? 'BTCFDUSD';
  const quoteAsset = (watchedSymbol.match(/FDUSD$|USDT$|USDC$|BUSD$/i)?.[0] ?? 'FDUSD').toUpperCase();
  const { data: balance } = useAssetBalance(watchedKey, quoteAsset);
  useEffect(() => {
    if (balance && balance.free && Number(balance.free) > 0 && !watch('totalQuoteInvestment')) {
      setValue('totalQuoteInvestment', Number(Number(balance.free).toFixed(2)));
    }
  }, [balance, setValue, watch]);

  // Watch all preview-relevant fields
  const w = watch();

  // ─── Live ticker price (used as anchor when useMarketPrice=true) ───
  const [marketPrice, setMarketPrice] = useState<number | undefined>();
  useEffect(() => {
    if (!watchedSymbol) return;
    let cancelled = false;
    const tick = () => {
      fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${watchedSymbol.toUpperCase()}`)
        .then((r) => r.json())
        .then((d: { price?: string }) => {
          if (!cancelled && d.price) setMarketPrice(Number(d.price));
        })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [watchedSymbol]);

  // Resolved anchor: explicit input if set & not useMarketPrice, else live ticker
  const resolvedAnchor = w.useMarketPrice
    ? marketPrice
    : (Number(w.anchorPrice) || marketPrice);

  // ─── Build preview levels ───
  const previewLevels = useMemo<PreviewLevel[]>(() => {
    if (isGrid) return buildGridPreview(w, resolvedAnchor);
    if (isGridSimple) return buildGridSimplePreview(w, marketPrice);
    if (isDcaSimple) return buildDcaSimplePreview(w, marketPrice);
    if (isDCA) return buildDCAPreview(w);
    if (isMACross) return buildMACrossPreview(w);
    return [];
  }, [w, isGrid, isGridSimple, isDcaSimple, isDCA, isMACross, resolvedAnchor, marketPrice]);

  const totals = useMemo<{ label: string; value: string }[]>(() => {
    const sumQuote = previewLevels.reduce((s, l) => s + l.quoteAmount, 0);
    const sumBase = previewLevels.reduce((s, l) => s + l.baseQty, 0);
    return [
      { label: 'Total orders', value: String(previewLevels.length) },
      { label: 'Total quote required', value: `$${sumQuote.toFixed(2)}` },
      { label: 'Estimated base if all fill', value: sumBase.toFixed(8) },
    ];
  }, [previewLevels]);

  const onSubmit = (data: FormData) => {
    if (!selectedStrategy) return toast.error('No strategy selected');
    if (!data.apiKeyId) return toast.error('Please select an API key');

    const params: Record<string, unknown> = {};
    if (isGrid) {
      const anchor = data.useMarketPrice
        ? marketPrice
        : Number(data.anchorPrice) || marketPrice;
      if (!anchor || !Number.isFinite(anchor) || anchor <= 0) {
        return toast.error('Could not resolve anchor price — set one or wait for live ticker');
      }
      const N = Number(data.gridLevels);
      const spacingValue = Number(data.gridSpacingValue);
      if (!Number.isFinite(spacingValue) || spacingValue <= 0) {
        return toast.error('Spacing value must be > 0');
      }
      const bounds = deriveGridBounds(anchor, data.gridSpacingType ?? 'percent', spacingValue, N);
      Object.assign(params, {
        lowerPrice: bounds.lower,
        upperPrice: bounds.upper,
        gridLevels: N,
        totalQuoteInvestment: Number(data.totalQuoteInvestment),
        orderSizeMultiplier: Number(data.orderSizeMultiplier ?? 1),
        gridMode: data.gridMode ?? 'long',
        initialPositionPct: Number(data.initialPositionPct ?? 0),
      });
      if (data.gridSpacingType === 'dollar') {
        params.spacingMode = 'fixed_dollar';
        params.spacingDollar = spacingValue;
      } else {
        params.spacingMode = 'geometric';
        params.priceMultiplier = 1 + spacingValue / 100;
      }
      // Only forward anchor if user explicitly overrode the live ticker
      if (!data.useMarketPrice && data.anchorPrice) {
        params.anchorPrice = Number(data.anchorPrice);
      }
      if (data.takeProfitPrice) params.takeProfitPrice = Number(data.takeProfitPrice);
      if (data.stopLossPrice) params.stopLossPrice = Number(data.stopLossPrice);
      if (data.trailingStopPct) params.trailingStopPct = Number(data.trailingStopPct);
      if (data.stopAfterCycles) params.stopAfterCycles = Number(data.stopAfterCycles);
      if (data.useExistingInventory) {
        params.useExistingInventory = true;
        params.existingInventoryPct = Number(data.existingInventoryPct ?? 100);
      }
    } else if (isGridSimple) {
      params.gridLevels = Number(data.gsGridLevels);
      params.gridSpread = Number(data.gsGridSpread);
      params.orderSize = Number(data.gsOrderSize);
      params.durationMinutes = Number(data.gsDurationMinutes ?? 0);
      if (data.gsUseCustomStartPrice && data.gsCustomStartPrice) {
        params.customStartPrice = Number(data.gsCustomStartPrice);
      }
    } else if (isDcaSimple) {
      params.direction = data.dsDirection ?? 'BUY';
      params.gridLevels = Number(data.dsGridLevels);
      params.gridSpread = Number(data.dsGridSpread);
      params.orderSize = Number(data.dsOrderSize);
      params.takeProfit = Number(data.dsTakeProfit);
      params.priceMultiplierMode = data.dsPriceMultiplierMode ?? 'flat';
      params.priceMultiplier = Number(data.dsPriceMultiplier ?? 0);
      params.sizeMultiplierMode = data.dsSizeMultiplierMode ?? 'flat';
      params.sizeMultiplier = Number(data.dsSizeMultiplier ?? 0);
      params.cooldownMinutes = Number(data.dsCooldownMinutes ?? 0);
      params.recenterAfterMinutes = Number(data.dsRecenterAfterMinutes ?? 0);
      params.durationMinutes = Number(data.dsDurationMinutes ?? 0);
      if (data.dsUseCustomStartPrice && data.dsCustomStartPrice) {
        params.customStartPrice = Number(data.dsCustomStartPrice);
      }
    } else if (isDCA) {
      params.direction = data.dcaDirection ?? 'BUY';
      params.totalQuoteInvestment = Number(data.totalQuoteInvestment);
      params.totalOrders = Number(data.totalOrders ?? 20);
      if (data.enableTimeGate && data.intervalMinutes) params.intervalMinutes = Number(data.intervalMinutes);
      if (data.enablePriceGate) {
        if (data.priceGateMode === 'dollar' && data.minPriceMoveDollar) {
          params.minPriceMoveDollar = Number(data.minPriceMoveDollar);
        } else if (data.minPriceMovePct) {
          params.minPriceMovePct = Number(data.minPriceMovePct);
        }
      }
      if (data.takeProfitPct) params.takeProfitPct = Number(data.takeProfitPct);
      if (data.stopLossPct) params.stopLossPct = Number(data.stopLossPct);
      if (!params.intervalMinutes && !params.minPriceMovePct && !params.minPriceMoveDollar) {
        return toast.error('Enable at least one gate (time, % price, or $ price)');
      }
    } else if (isMACross) {
      params.fastPeriod = Number(data.fastPeriod ?? 9);
      params.slowPeriod = Number(data.slowPeriod ?? 21);
      params.quoteAmountPerTrade = Number(data.quoteAmountPerTrade);
      if (data.takeProfitPct) params.takeProfitPct = Number(data.takeProfitPct);
      if (data.stopLossPct) params.stopLossPct = Number(data.stopLossPct);
    } else if (isGraph) {
      params.cooldownSec = Number(data.cooldownSec ?? 60);
    }

    create.mutate(
      {
        name: data.name,
        strategyId: selectedStrategy.id,
        apiKeyId: data.apiKeyId,
        symbol: data.symbol.toUpperCase(),
        params,
        paperTrading: !!data.paperTrading,
        ...(data.dailyLossLimit ? { dailyLossLimit: Number(data.dailyLossLimit) } : {}),
        ...(data.maxDrawdownPct ? { maxDrawdownPct: Number(data.maxDrawdownPct) } : {}),
      },
      {
        onSuccess: (b) => { toast.success('Bot created!'); router.push(`/bots/${b.id}`); },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  if (!activeKeys.length) {
    return (
      <Card className="max-w-2xl">
        <CardHeader><CardTitle>No active API key</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">You need to add and verify a Binance API key first.</p>
          <Button asChild><Link href="/exchange-keys">Add API key</Link></Button>
        </CardContent>
      </Card>
    );
  }

  const balanceHint = balance?.free && Number(balance.free) > 0
    ? `Available ${quoteAsset}: ${Number(balance.free).toFixed(2)} (auto-filled)`
    : undefined;

  return (
    <div className="max-w-[1400px]">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Create new bot</h1>
        <p className="text-muted-foreground">
          {isGraph ? `Configure a custom-graph bot from "${selectedStrategy?.name}".`
            : isDCA ? 'Configure a Dollar-Cost Averaging bot.'
            : isMACross ? 'Configure an MA Crossover bot.'
            : 'Configure a Grid Trading bot for Binance.'}
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_460px] gap-6">
        {/* ─────── Form ─────── */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Strategy</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedStrategy?.id ?? ''}
                onChange={(e) => router.push(`/bots/new?strategyId=${e.target.value}`)}>
                {strategies?.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
                ))}
              </select>
              {selectedStrategy && (
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  <Badge variant={selectedStrategy.visibility === 'BUILTIN' ? 'default' : 'outline'} className="text-[9px]">
                    {selectedStrategy.visibility}
                  </Badge>
                  <span>{selectedStrategy.description}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Bot name" error={errors.name?.message}>
                <Input placeholder="My BTC bot" {...register('name', { required: 'Required' })} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Symbol">
                  <Input placeholder="BTCFDUSD" {...register('symbol', { required: true })} />
                </Field>
                <Field label="API Key">
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    {...register('apiKeyId', { required: true })}>
                    <option value="">Select an API key</option>
                    {activeKeys.map((k) => (<option key={k.id} value={k.id}>{k.label}</option>))}
                  </select>
                </Field>
              </div>
            </CardContent>
          </Card>

          {/* ─── Grid (simplified pro layout) ─── */}
          {isGrid && (
            <Card>
              <CardHeader>
                <CardTitle>Grid Configuration</CardTitle>
                <CardDescription>
                  Set anchor price, spacing, and number of orders — bounds are derived automatically.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* ─── 1. Anchor / start price ─── */}
                <section className="space-y-3">
                  <SectionHeader n={1} title="Start price" />
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-0.5" {...register('useMarketPrice')} />
                    <div className="flex-1">
                      <div className="font-medium">Start from current market price</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span>Bot anchors to the live ticker on launch.</span>
                        {marketPrice && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            ${marketPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </label>
                  {!w.useMarketPrice && (
                    <Field label="Custom anchor price" hint="The reference 'current price' the grid centers on.">
                      <Input type="number" step="any" placeholder="e.g. 78000"
                        {...register('anchorPrice', { valueAsNumber: true })} />
                    </Field>
                  )}
                </section>

                {/* ─── 2. Spacing & levels ─── */}
                <section className="space-y-3 pt-2 border-t">
                  <SectionHeader n={2} title="Grid shape" />
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Spacing type">
                      <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        {...register('gridSpacingType')}>
                        <option value="percent">% per level</option>
                        <option value="dollar">$ per level</option>
                      </select>
                    </Field>
                    <Field label={w.gridSpacingType === 'dollar' ? '$ gap' : '% gap'}
                      hint={w.gridSpacingType === 'dollar' ? 'e.g. 100 = $100 between levels' : 'e.g. 1 = 1% between levels'}>
                      <Input type="number" step="any" min={0.01}
                        placeholder={w.gridSpacingType === 'dollar' ? '100' : '1'}
                        {...register('gridSpacingValue', { valueAsNumber: true })} />
                    </Field>
                    <Field label="Total levels" hint="Half above, half below anchor (2–200).">
                      <Input type="number" min={2} max={200}
                        {...register('gridLevels', { required: true, valueAsNumber: true })} />
                    </Field>
                  </div>
                  {/* Derived range chip */}
                  {(() => {
                    const N = Number(w.gridLevels);
                    const v = Number(w.gridSpacingValue);
                    if (!resolvedAnchor || !Number.isFinite(N) || N < 2 || !Number.isFinite(v) || v <= 0) return null;
                    const b = deriveGridBounds(resolvedAnchor, w.gridSpacingType ?? 'percent', v, N);
                    return (
                      <div className="rounded border bg-muted/30 px-3 py-2 text-xs flex items-center justify-between font-mono">
                        <span className="text-muted-foreground">Derived range:</span>
                        <span className="font-semibold">
                          ${b.lower.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          <span className="text-muted-foreground mx-2">→</span>
                          ${b.upper.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </span>
                      </div>
                    );
                  })()}
                </section>

                {/* ─── 3. Capital & direction ─── */}
                <section className="space-y-3 pt-2 border-t">
                  <SectionHeader n={3} title="Capital & direction" />
                  <Field label={`Total investment (${quoteAsset})`} hint={balanceHint}>
                    <Input type="number" step="any"
                      {...register('totalQuoteInvestment', { required: true, valueAsNumber: true })} />
                  </Field>
                  <Field label="Grid mode" hint="Long = BUY low / SELL high. Short = SELL high / BUY low. Neutral = both immediately.">
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" {...register('gridMode')}>
                      <option value="long">Long — accumulate base on dips</option>
                      <option value="short">Short — distribute base on rallies</option>
                      <option value="neutral">Neutral — both sides immediately</option>
                    </select>
                  </Field>
                </section>

                {/* ─── 4. Inventory source ─── */}
                <section className="space-y-3 pt-2 border-t">
                  <SectionHeader n={4} title="Inventory source" />
                  <div className="rounded-md border bg-accent/20 p-3 space-y-2">
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="mt-0.5" {...register('useExistingInventory')} />
                      <div>
                        <div className="font-medium">Use my existing wallet balance</div>
                        <div className="text-xs text-muted-foreground">
                          Seed SELL orders from already-held base coin instead of doing an upfront market BUY.
                        </div>
                      </div>
                    </label>
                    {w.useExistingInventory && (
                      <Field label="% of free balance to use" hint="1–100. Default 100 = use all available.">
                        <Input type="number" step="any" min={1} max={100} placeholder="100"
                          {...register('existingInventoryPct', { valueAsNumber: true })} />
                      </Field>
                    )}
                  </div>
                  {!w.useExistingInventory && (
                    <Field label="Initial position %" hint="0–100. Spends X% on instant BUY to enable immediate SELLs above anchor.">
                      <Input type="number" step="any" min={0} max={100} placeholder="0"
                        {...register('initialPositionPct', { valueAsNumber: true })} />
                    </Field>
                  )}
                </section>

                {/* ─── 5. Advanced (collapsible) ─── */}
                <details className="pt-2 border-t group">
                  <summary className="cursor-pointer list-none flex items-center justify-between py-2 text-sm font-semibold">
                    <span className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-muted text-[11px]">5</span>
                      Advanced
                    </span>
                    <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
                    <span className="text-xs text-muted-foreground hidden group-open:inline">Hide</span>
                  </summary>
                  <div className="space-y-3 pt-2">
                    <Field label="Order size multiplier" hint=">1 = bigger orders at higher levels (martingale). 1 = equal sizing.">
                      <Input type="number" step="0.01" min={0.1} max={10}
                        {...register('orderSizeMultiplier', { valueAsNumber: true })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Take profit price" hint="Exit when price ≥ this.">
                        <Input type="number" step="any" placeholder="optional"
                          {...register('takeProfitPrice', { valueAsNumber: true })} />
                      </Field>
                      <Field label="Stop loss price" hint="Exit when price ≤ this.">
                        <Input type="number" step="any" placeholder="optional"
                          {...register('stopLossPrice', { valueAsNumber: true })} />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Trailing stop %" hint="Exits if price drops X% from peak.">
                        <Input type="number" step="any" min={0.1} max={50} placeholder="optional"
                          {...register('trailingStopPct', { valueAsNumber: true })} />
                      </Field>
                      <Field label="Stop after N cycles" hint="Auto-stop after N BUY→SELL round-trips.">
                        <Input type="number" min={1} max={10000} placeholder="unlimited"
                          {...register('stopAfterCycles', { valueAsNumber: true })} />
                      </Field>
                    </div>
                  </div>
                </details>
              </CardContent>
            </Card>
          )}

          {/* ─── Grid Simple (x2-style symmetric ladder) ─── */}
          {isGridSimple && (
            <Card>
              <CardHeader>
                <CardTitle>Grid Simple — Configuration</CardTitle>
                <CardDescription>
                  Symmetric ladder around current price. 4 inputs, both sides placed immediately,
                  uses LIMIT_MAKER (zero fees), self-heals every 5 minutes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Live ticker */}
                <div className="rounded-md border bg-accent/20 px-3 py-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Live price ({watchedSymbol})</span>
                  <span className="font-mono font-semibold">
                    {marketPrice ? `$${marketPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : '—'}
                  </span>
                </div>

                {/* Core 4 fields */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Levels per side" hint="Total orders = 2 × this. e.g. 20 → 20 BUYs + 20 SELLs.">
                    <Input type="number" min={1} max={200}
                      {...register('gsGridLevels', { required: true, valueAsNumber: true })} />
                  </Field>
                  <Field label="Grid spread ($)" hint={`Distance between levels and profit per round-trip. e.g. 10 = $10.`}>
                    <Input type="number" step="any" min={0.00001}
                      {...register('gsGridSpread', { required: true, valueAsNumber: true })} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label={`Order size (${quoteAsset})`} hint="Quote $ per BUY/SELL. e.g. 10 = $10/order.">
                    <Input type="number" step="any" min={0.0001}
                      {...register('gsOrderSize', { required: true, valueAsNumber: true })} />
                  </Field>
                  <Field label="Duration (minutes)" hint="0 = run until you stop it.">
                    <Input type="number" min={0}
                      {...register('gsDurationMinutes', { valueAsNumber: true })} />
                  </Field>
                </div>

                {/* Custom start price (collapsed by default) */}
                <div className="rounded-md border bg-accent/10 p-3 space-y-2">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-0.5"
                      {...register('gsUseCustomStartPrice')} />
                    <div>
                      <div className="font-medium">Use custom start price</div>
                      <div className="text-xs text-muted-foreground">
                        Override the live ticker. The grid will center on this price instead.
                      </div>
                    </div>
                  </label>
                  {w.gsUseCustomStartPrice && (
                    <Field label="Custom start price">
                      <Input type="number" step="any" min={0.00001} placeholder="e.g. 78000"
                        {...register('gsCustomStartPrice', { valueAsNumber: true })} />
                    </Field>
                  )}
                </div>

                {/* Capital required summary */}
                {(() => {
                  const N = Number(w.gsGridLevels);
                  const sz = Number(w.gsOrderSize);
                  if (!Number.isFinite(N) || !Number.isFinite(sz) || N < 1 || sz <= 0) return null;
                  const buyCapital = N * sz;
                  return (
                    <div className="rounded border bg-muted/30 px-3 py-2 text-xs space-y-1 font-mono">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total orders:</span>
                        <span className="font-semibold">{2 * N}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{quoteAsset} required for BUYs:</span>
                        <span className="font-semibold">${buyCapital.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Profit per round-trip:</span>
                        <span className="font-semibold text-success">
                          ~${(Number(w.gsGridSpread || 0) * (sz / (marketPrice || 1))).toFixed(4)}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* ─── DCA Simple (x2-style ladder DCA) ─── */}
          {isDcaSimple && (
            <Card>
              <CardHeader>
                <CardTitle>DCA Simple — Configuration</CardTitle>
                <CardDescription>
                  Ladder DCA: places N orders descending (BUY) or ascending (SELL) from current price.
                  Each fill updates avg cost; a single TP/BB sits at avg ± takeProfit. On counter
                  fill, realizes profit and rebuilds the ladder. Uses LIMIT_MAKER (zero fees).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Live ticker */}
                <div className="rounded-md border bg-accent/20 px-3 py-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Live price ({watchedSymbol})</span>
                  <span className="font-mono font-semibold">
                    {marketPrice ? `$${marketPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : '—'}
                  </span>
                </div>

                {/* Direction */}
                <Field label="Direction" hint="BUY = accumulate below market, then liquidate at TP. SELL = distribute above market, then buy back.">
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    {...register('dsDirection')}
                  >
                    <option value="BUY">BUY — accumulate (descending ladder)</option>
                    <option value="SELL">SELL — distribute (ascending ladder)</option>
                  </select>
                </Field>

                {/* Ladder shape */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Ladder length" hint="Number of orders in the ladder (1–200).">
                    <Input type="number" min={1} max={200}
                      {...register('dsGridLevels', { required: true, valueAsNumber: true })} />
                  </Field>
                  <Field label="Spread ($)" hint="Distance between adjacent rungs.">
                    <Input type="number" step="any" min={0.00001}
                      {...register('dsGridSpread', { required: true, valueAsNumber: true })} />
                  </Field>
                </div>

                {/* Sizing & TP */}
                <div className="grid grid-cols-2 gap-4">
                  <Field label={`Order size (${quoteAsset})`} hint="Quote $ per ladder order.">
                    <Input type="number" step="any" min={0.0001}
                      {...register('dsOrderSize', { required: true, valueAsNumber: true })} />
                  </Field>
                  <Field label="Take profit ($)" hint={
                    w.dsDirection === 'SELL'
                      ? 'BB target = avg sell − this. Buy back below avg.'
                      : 'TP target = avg cost + this. Liquidate above avg.'
                  }>
                    <Input type="number" step="any" min={0.00001}
                      {...register('dsTakeProfit', { required: true, valueAsNumber: true })} />
                  </Field>
                </div>

                {/* ─── Multipliers (martingale-style progression) ─── */}
                <details className="rounded-md border bg-accent/10 p-3 group">
                  <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-medium select-none">
                    <span>Advanced — Multipliers</span>
                    <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
                    <span className="text-xs text-muted-foreground hidden group-open:inline">Hide</span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Make later ladder rungs use bigger price gaps and / or bigger order sizes.
                      Set mode to <code className="px-1 bg-muted rounded">flat</code> for the
                      default constant ladder.
                    </p>

                    {/* Price multiplier */}
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Price gap multiplier" hint="How the spread between adjacent rungs grows.">
                        <select
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          {...register('dsPriceMultiplierMode')}
                        >
                          <option value="flat">Flat — constant</option>
                          <option value="percent">Percent (%) — geometric</option>
                          <option value="dollar">Dollar ($) — arithmetic</option>
                        </select>
                      </Field>
                      <Field
                        label={
                          w.dsPriceMultiplierMode === 'percent' ? 'Growth (%)'
                            : w.dsPriceMultiplierMode === 'dollar' ? 'Growth ($)'
                              : 'Growth value'
                        }
                        hint={
                          w.dsPriceMultiplierMode === 'percent'
                            ? 'e.g. 10 → each gap is 10% bigger than previous.'
                            : w.dsPriceMultiplierMode === 'dollar'
                              ? 'e.g. 5 → each gap grows by $5.'
                              : 'Disabled (flat mode).'
                        }
                      >
                        <Input
                          type="number" step="any" min={0}
                          disabled={w.dsPriceMultiplierMode === 'flat'}
                          {...register('dsPriceMultiplier', { valueAsNumber: true })}
                        />
                      </Field>
                    </div>

                    {/* Size multiplier */}
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Order size multiplier" hint="How order size grows per rung (martingale).">
                        <select
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          {...register('dsSizeMultiplierMode')}
                        >
                          <option value="flat">Flat — constant</option>
                          <option value="percent">Percent (%) — geometric</option>
                          <option value="dollar">Dollar ($) — arithmetic</option>
                        </select>
                      </Field>
                      <Field
                        label={
                          w.dsSizeMultiplierMode === 'percent' ? 'Growth (%)'
                            : w.dsSizeMultiplierMode === 'dollar' ? 'Growth ($)'
                              : 'Growth value'
                        }
                        hint={
                          w.dsSizeMultiplierMode === 'percent'
                            ? 'e.g. 20 → each order is 20% bigger than previous.'
                            : w.dsSizeMultiplierMode === 'dollar'
                              ? 'e.g. 2 → each order grows by $2.'
                              : 'Disabled (flat mode).'
                        }
                      >
                        <Input
                          type="number" step="any" min={0}
                          disabled={w.dsSizeMultiplierMode === 'flat'}
                          {...register('dsSizeMultiplier', { valueAsNumber: true })}
                        />
                      </Field>
                    </div>
                  </div>
                </details>

                {/* ─── Cooldown + Recenter (cycle lifecycle controls) ─── */}
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="Cooldown after cycle (min)"
                    hint="When the counter (TP/BB) fills, idle for this many minutes before rebuilding. 0 = rebuild immediately."
                  >
                    <Input type="number" min={0}
                      {...register('dsCooldownMinutes', { valueAsNumber: true })} />
                  </Field>
                  <Field
                    label="Recenter after inactivity (min)"
                    hint="If NO ladder rung fills for this many minutes (price drifted), abort the cycle, run cooldown, then rebuild around the new market. 0 = disabled."
                  >
                    <Input type="number" min={0}
                      {...register('dsRecenterAfterMinutes', { valueAsNumber: true })} />
                  </Field>
                </div>

                {/* Duration */}
                <Field label="Duration (minutes)" hint="0 = run until you stop it.">
                  <Input type="number" min={0}
                    {...register('dsDurationMinutes', { valueAsNumber: true })} />
                </Field>

                {/* Custom start price */}
                <div className="rounded-md border bg-accent/10 p-3 space-y-2">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-0.5"
                      {...register('dsUseCustomStartPrice')} />
                    <div>
                      <div className="font-medium">Use custom start price</div>
                      <div className="text-xs text-muted-foreground">
                        Override the live ticker. The ladder will be built around this price instead.
                      </div>
                    </div>
                  </label>
                  {w.dsUseCustomStartPrice && (
                    <Field label="Custom start price">
                      <Input type="number" step="any" min={0.00001} placeholder="e.g. 78000"
                        {...register('dsCustomStartPrice', { valueAsNumber: true })} />
                    </Field>
                  )}
                </div>

                {/* Capital summary — uses the SAME multiplier math as the strategy */}
                {(() => {
                  const levels = previewLevels.filter((l) => l.side === w.dsDirection);
                  if (levels.length === 0 || !marketPrice) return null;
                  const totalCapital = levels.reduce((s, l) => s + l.quoteAmount, 0);
                  const totalQty = levels.reduce((s, l) => s + l.baseQty, 0);
                  const tp = Number(w.dsTakeProfit);
                  const profitPerCycle = (Number.isFinite(tp) && tp > 0) ? tp * totalQty : 0;
                  const firstPrice = levels[0]!.price;
                  const lastPrice = levels[levels.length - 1]!.price;
                  const ladderRange = `${firstPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} → ${lastPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
                  const cd = Number(w.dsCooldownMinutes ?? 0);
                  return (
                    <div className="rounded border bg-muted/30 px-3 py-2 text-xs space-y-1 font-mono">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Ladder range:</span>
                        <span className="font-semibold">{ladderRange}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{quoteAsset} required:</span>
                        <span className="font-semibold">${totalCapital.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Approx profit / cycle (full ladder):</span>
                        <span className="font-semibold text-success">
                          ~${profitPerCycle.toFixed(4)}
                        </span>
                      </div>
                      {cd > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Cooldown after each cycle:</span>
                          <span className="font-semibold text-primary">{cd}m</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* ─── DCA (legacy) ─── */}
          {isDCA && (
            <Card>
              <CardHeader>
                <CardTitle>DCA Configuration</CardTitle>
                <CardDescription>Direction + flexible gates (time, price, or both).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Direction">
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" {...register('dcaDirection')}>
                      <option value="BUY">DCA BUY (accumulate)</option>
                      <option value="SELL">DCA SELL (distribute)</option>
                    </select>
                  </Field>
                  <Field label="Number of orders">
                    <Input type="number" min={1} max={1000} {...register('totalOrders', { valueAsNumber: true })} />
                  </Field>
                </div>
                <Field label={`Total ${w.dcaDirection === 'SELL' ? 'value to distribute' : 'investment'} (${quoteAsset})`} hint={balanceHint}>
                  <Input type="number" step="any" {...register('totalQuoteInvestment', { required: true, valueAsNumber: true })} />
                </Field>

                <div className="border rounded-md p-3 space-y-3 bg-accent/20">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Trigger gates (at least one)</div>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" {...register('enableTimeGate')} />
                    <span className="font-medium text-sm">⏱ Time interval</span>
                  </label>
                  {w.enableTimeGate && (
                    <Field label="Minutes between orders">
                      <Input type="number" min={1} {...register('intervalMinutes', { valueAsNumber: true })} />
                    </Field>
                  )}
                  <label className="flex items-center gap-3 pt-1">
                    <input type="checkbox" {...register('enablePriceGate')} />
                    <span className="font-medium text-sm">📉 Price movement</span>
                  </label>
                  {w.enablePriceGate && (
                    <div className="space-y-2 pl-6">
                      <div className="flex gap-3 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" value="pct" {...register('priceGateMode')} defaultChecked />
                          % percentage
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" value="dollar" {...register('priceGateMode')} />
                          $ absolute
                        </label>
                      </div>
                      {(w.priceGateMode ?? 'pct') === 'pct' ? (
                        <Field label={`Minimum % ${w.dcaDirection === 'SELL' ? 'rise' : 'drop'} since last order`}>
                          <Input type="number" step="any" placeholder="e.g. 1.5" {...register('minPriceMovePct', { valueAsNumber: true })} />
                        </Field>
                      ) : (
                        <Field label={`Minimum $ ${w.dcaDirection === 'SELL' ? 'rise' : 'drop'} since last order`}>
                          <Input type="number" step="any" placeholder="e.g. 100" {...register('minPriceMoveDollar', { valueAsNumber: true })} />
                        </Field>
                      )}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Both checked: requires BOTH gates. Only one: just that gate.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Take profit % (optional)"><Input type="number" step="any" {...register('takeProfitPct', { valueAsNumber: true })} /></Field>
                  <Field label="Stop loss % (optional)"><Input type="number" step="any" {...register('stopLossPct', { valueAsNumber: true })} /></Field>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ─── MA Cross ─── */}
          {isMACross && (
            <Card>
              <CardHeader>
                <CardTitle>MA Crossover Configuration</CardTitle>
                <CardDescription>Buys on golden cross, sells on death cross.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Fast SMA period"><Input type="number" min={2} max={500} {...register('fastPeriod', { valueAsNumber: true })} /></Field>
                  <Field label="Slow SMA period"><Input type="number" min={2} max={500} {...register('slowPeriod', { valueAsNumber: true })} /></Field>
                </div>
                <Field label={`Quote per trade (${quoteAsset})`}>
                  <Input type="number" step="any" {...register('quoteAmountPerTrade', { required: true, valueAsNumber: true })} />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Take profit % (optional)"><Input type="number" step="any" {...register('takeProfitPct', { valueAsNumber: true })} /></Field>
                  <Field label="Stop loss % (optional)"><Input type="number" step="any" {...register('stopLossPct', { valueAsNumber: true })} /></Field>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ─── Graph ─── */}
          {isGraph && (
            <Card>
              <CardHeader>
                <CardTitle>Graph Settings</CardTitle>
                <CardDescription>The strategy graph is loaded from the saved strategy.</CardDescription>
              </CardHeader>
              <CardContent>
                <Field label="Cooldown between actions (seconds)">
                  <Input type="number" min={1} max={86400} {...register('cooldownSec', { valueAsNumber: true })} />
                </Field>
              </CardContent>
            </Card>
          )}

          {/* Risk Management */}
          <Card>
            <CardHeader>
              <CardTitle>🛡️ Risk Management</CardTitle>
              <CardDescription>Auto-stop the bot if these limits are breached.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label={`Daily loss limit (${quoteAsset}, optional)`}>
                  <Input type="number" step="any" placeholder="e.g. 50" {...register('dailyLossLimit', { valueAsNumber: true })} />
                </Field>
                <Field label="Max drawdown % from peak (optional)">
                  <Input type="number" step="any" min={0.1} max={100} placeholder="e.g. 10" {...register('maxDrawdownPct', { valueAsNumber: true })} />
                </Field>
              </div>
            </CardContent>
          </Card>

          {/* Paper trading */}
          <Card>
            <CardContent className="pt-6">
              <label className="flex items-start gap-3 p-3 rounded-md border border-dashed cursor-pointer hover:bg-accent/30">
                <input type="checkbox" {...register('paperTrading')} className="mt-1" />
                <div>
                  <div className="font-medium text-sm">Paper trading mode</div>
                  <div className="text-xs text-muted-foreground">Simulate orders without sending them to Binance.</div>
                </div>
              </label>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create bot
            </Button>
          </div>
        </form>

        {/* ─────── Live Preview (right column) ─────── */}
        <div className="lg:block">
          <BotPreview
            symbol={watchedSymbol}
            marketPrice={marketPrice}
            levels={previewLevels}
            totals={totals}
            emptyMessage="Fill the form to see a live order map."
            anchorPrice={isGridSimple
              ? (w.gsUseCustomStartPrice && w.gsCustomStartPrice ? Number(w.gsCustomStartPrice) : marketPrice)
              : isDcaSimple
                ? (w.dsUseCustomStartPrice && w.dsCustomStartPrice ? Number(w.dsCustomStartPrice) : marketPrice)
                : resolvedAnchor}
            initialPositionPct={w.initialPositionPct ? Number(w.initialPositionPct) : undefined}
            useExistingInventory={w.useExistingInventory || undefined}
            existingInventoryPct={w.existingInventoryPct ? Number(w.existingInventoryPct) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function Field({ label, error, hint, children }: {
  label: string; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Derive lower/upper price bounds from anchor + spacing + level count.
 * Levels are split symmetrically around the anchor (half above, half below).
 */
function deriveGridBounds(
  anchor: number,
  type: 'percent' | 'dollar',
  value: number,
  totalLevels: number,
): { lower: number; upper: number } {
  const halfBelow = Math.floor((totalLevels - 1) / 2);
  const halfAbove = (totalLevels - 1) - halfBelow;
  if (type === 'dollar') {
    return {
      lower: Math.max(0.00000001, anchor - value * halfBelow),
      upper: anchor + value * halfAbove,
    };
  }
  const mult = 1 + value / 100;
  return {
    lower: anchor / Math.pow(mult, halfBelow),
    upper: anchor * Math.pow(mult, halfAbove),
  };
}

function SectionHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-[11px] font-bold">{n}</span>
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  );
}

function buildGridPreview(w: FormData, resolvedAnchor?: number): PreviewLevel[] {
  const N = Number(w.gridLevels);
  const total = Number(w.totalQuoteInvestment);
  const sizeMult = Number(w.orderSizeMultiplier ?? 1);
  const spacingValue = Number(w.gridSpacingValue);
  const spacingType = w.gridSpacingType ?? 'percent';
  const gridMode = w.gridMode ?? 'long';

  if (!resolvedAnchor || !Number.isFinite(N) || N < 2 ||
      !Number.isFinite(spacingValue) || spacingValue <= 0 ||
      !Number.isFinite(total) || total <= 0) return [];

  const bounds = deriveGridBounds(resolvedAnchor, spacingType, spacingValue, N);
  const prices: number[] = [];
  if (spacingType === 'dollar') {
    for (let i = 0; i < N; i++) prices.push(bounds.lower + spacingValue * i);
  } else {
    const mult = 1 + spacingValue / 100;
    for (let i = 0; i < N; i++) prices.push(bounds.lower * Math.pow(mult, i));
  }

  const baseQuote = sizeMult === 1
    ? total / N
    : (total * (sizeMult - 1)) / (Math.pow(sizeMult, N) - 1);

  return prices.map((p, i) => {
    const quote = sizeMult === 1 ? baseQuote : baseQuote * Math.pow(sizeMult, i);
    let side: 'BUY' | 'SELL';
    if (gridMode === 'short') side = p > resolvedAnchor ? 'SELL' : 'BUY';
    else side = p < resolvedAnchor ? 'BUY' : 'SELL';
    return { index: i, price: p, quoteAmount: quote, baseQty: quote / p, side };
  });
}

function buildGridSimplePreview(w: FormData, marketPrice?: number): PreviewLevel[] {
  const N = Number(w.gsGridLevels);
  const spread = Number(w.gsGridSpread);
  const orderSize = Number(w.gsOrderSize);
  const start = w.gsUseCustomStartPrice && w.gsCustomStartPrice
    ? Number(w.gsCustomStartPrice)
    : marketPrice;
  if (!start || !Number.isFinite(N) || N < 1 || !Number.isFinite(spread) || spread <= 0
      || !Number.isFinite(orderSize) || orderSize <= 0) return [];
  const out: PreviewLevel[] = [];
  for (let i = 1; i <= N; i++) {
    const buyPrice = start - i * spread;
    const sellPrice = start + i * spread;
    if (buyPrice > 0) {
      out.push({ index: -i, price: buyPrice, quoteAmount: orderSize, baseQty: orderSize / buyPrice, side: 'BUY' });
    }
    out.push({ index: i, price: sellPrice, quoteAmount: orderSize, baseQty: orderSize / sellPrice, side: 'SELL' });
  }
  return out;
}

function buildDcaSimplePreview(w: FormData, marketPrice?: number): PreviewLevel[] {
  const N = Number(w.dsGridLevels);
  const baseSpread = Number(w.dsGridSpread);
  const baseSize = Number(w.dsOrderSize);
  const tp = Number(w.dsTakeProfit);
  const dir = w.dsDirection ?? 'BUY';
  const priceMode = w.dsPriceMultiplierMode ?? 'flat';
  const priceMult = Number(w.dsPriceMultiplier ?? 0);
  const sizeMode = w.dsSizeMultiplierMode ?? 'flat';
  const sizeMult = Number(w.dsSizeMultiplier ?? 0);

  const start = w.dsUseCustomStartPrice && w.dsCustomStartPrice
    ? Number(w.dsCustomStartPrice)
    : marketPrice;
  if (!start || !Number.isFinite(N) || N < 1
      || !Number.isFinite(baseSpread) || baseSpread <= 0
      || !Number.isFinite(baseSize) || baseSize <= 0) return [];

  // Mirror strategy._rungSpec so the preview matches what the bot will place.
  const rungSpec = (i: number): { offset: number; sizeQuote: number } => {
    let offset: number;
    if (priceMode === 'percent') {
      const r = 1 + priceMult / 100;
      offset = r === 1 ? baseSpread * i : baseSpread * (Math.pow(r, i) - 1) / (r - 1);
    } else if (priceMode === 'dollar') {
      offset = i * baseSpread + priceMult * i * (i - 1) / 2;
    } else {
      offset = baseSpread * i;
    }
    let sizeQuote: number;
    const k = i - 1;
    if (sizeMode === 'percent') sizeQuote = baseSize * Math.pow(1 + sizeMult / 100, k);
    else if (sizeMode === 'dollar') sizeQuote = baseSize + sizeMult * k;
    else sizeQuote = baseSize;
    if (sizeQuote <= 0) sizeQuote = baseSize;
    return { offset, sizeQuote };
  };

  const out: PreviewLevel[] = [];
  for (let i = 1; i <= N; i++) {
    const { offset, sizeQuote } = rungSpec(i);
    const price = dir === 'BUY' ? start - offset : start + offset;
    if (price <= 0) continue;
    out.push({
      index: dir === 'BUY' ? -i : i,
      price,
      quoteAmount: sizeQuote,
      baseQty: sizeQuote / price,
      side: dir,
    });
  }
  // Counter (TP/BB) marker at the *expected* avg ± tp after filling all rungs.
  if (Number.isFinite(tp) && tp > 0 && out.length > 0) {
    const totalQty = out.reduce((s, l) => s + l.baseQty, 0);
    const totalQuote = out.reduce((s, l) => s + l.quoteAmount, 0);
    const avg = totalQuote / totalQty;
    const counterPrice = dir === 'BUY' ? avg + tp : avg - tp;
    const counterSide = dir === 'BUY' ? 'SELL' : 'BUY';
    out.push({
      index: dir === 'BUY' ? N + 1 : -(N + 1),
      price: counterPrice,
      quoteAmount: totalQuote,
      baseQty: totalQty,
      side: counterSide,
    });
  }
  return out;
}

function buildDCAPreview(w: FormData): PreviewLevel[] {
  const N = Number(w.totalOrders ?? 0);
  const total = Number(w.totalQuoteInvestment);
  if (!Number.isFinite(N) || N < 1 || !Number.isFinite(total) || total <= 0) return [];
  const perOrder = total / N;
  // We don't know future prices; show as a flat band centered on current price
  // (approximation — actual prices will vary). Use price drop spec if set.
  const dropPct = Number(w.minPriceMovePct ?? 1);
  const direction = w.dcaDirection ?? 'BUY';
  const out: PreviewLevel[] = [];
  for (let i = 0; i < N; i++) {
    // Each subsequent order placed at progressively lower (BUY) or higher (SELL) prices
    const priceFactor = direction === 'BUY'
      ? 1 - (dropPct / 100) * i
      : 1 + (dropPct / 100) * i;
    out.push({
      index: i,
      price: priceFactor, // relative — preview will scale around 1
      quoteAmount: perOrder,
      baseQty: 0, // not meaningful in relative view
      side: direction,
    });
  }
  // Convert relative prices into absolute using a placeholder reference of 1.0
  // The preview component handles auto-scaling, so this still renders nicely.
  return out;
}

function buildMACrossPreview(w: FormData): PreviewLevel[] {
  const amount = Number(w.quoteAmountPerTrade);
  if (!Number.isFinite(amount) || amount <= 0) return [];
  return [
    { index: 0, price: 1.05, quoteAmount: amount, baseQty: amount / 1.05, side: 'SELL' },
    { index: 1, price: 1.00, quoteAmount: amount, baseQty: amount / 1.00, side: 'BUY' },
  ];
}
