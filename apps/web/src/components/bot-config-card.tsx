'use client';
import { Settings2, Layers, Target, Timer, Sparkles, Coins, Hourglass } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';

/**
 * Compact, strategy-aware view of the bot's configured parameters.
 *
 * Detects the strategy from `builtinKey` and renders only the relevant fields.
 * Hides multiplier rows when in 'flat' mode and hides cooldown / duration when 0.
 */
export function BotConfigCard({
  builtinKey,
  params,
  paperTrading,
  quoteAsset,
}: {
  builtinKey?: string | null;
  params?: Record<string, unknown>;
  paperTrading?: boolean;
  quoteAsset: string;
}) {
  const p = params ?? {};
  const isGridSimple = builtinKey === 'grid_simple';
  const isDcaSimple = builtinKey === 'dca_simple';

  const direction = (p.direction as string | undefined)?.toUpperCase();
  const gridLevels = num(p.gridLevels);
  const gridSpread = num(p.gridSpread);
  const orderSize = num(p.orderSize);
  const takeProfit = num(p.takeProfit);
  const customStartPrice = num(p.customStartPrice);
  const durationMinutes = num(p.durationMinutes);
  const cooldownMinutes = num(p.cooldownMinutes);
  const recenterAfterMinutes = num(p.recenterAfterMinutes);

  const priceMultMode = (p.priceMultiplierMode as string | undefined) ?? 'flat';
  const priceMult = num(p.priceMultiplier);
  const sizeMultMode = (p.sizeMultiplierMode as string | undefined) ?? 'flat';
  const sizeMult = num(p.sizeMultiplier);

  const totalCapital = (gridLevels !== null && orderSize !== null)
    ? gridLevels * orderSize : null;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            Bot configuration
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {paperTrading && (
              <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-700 dark:text-yellow-400">
                paper
              </Badge>
            )}
            {direction && (
              <Badge
                variant={direction === 'BUY' ? 'success' : 'destructive'}
                className="text-[10px] font-mono"
              >
                {direction}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription className="text-xs">
          The parameters this bot is running with. Edit only when stopped.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ─── Ladder shape (Grid Simple + DCA Simple) ─── */}
        {(isGridSimple || isDcaSimple) && gridLevels !== null && (
          <Section icon={<Layers className="h-3 w-3" />} title="Ladder">
            <Row label={isGridSimple ? 'Levels per side' : 'Ladder length'}
              value={isGridSimple ? `${gridLevels} × 2 = ${gridLevels * 2} orders` : `${gridLevels} rungs`} />
            {gridSpread !== null && (
              <Row label="Base spread" value={`$${formatNumber(gridSpread, { maximumFractionDigits: 4 })}`} />
            )}
            {orderSize !== null && (
              <Row
                label={isDcaSimple ? 'Base order size' : 'Order size'}
                value={`$${formatNumber(orderSize, { maximumFractionDigits: 2 })} ${quoteAsset}`}
              />
            )}
            {totalCapital !== null && isGridSimple && (
              <Row label="Total capital" value={`$${formatNumber(totalCapital, { maximumFractionDigits: 2 })} ${quoteAsset}`} muted />
            )}
          </Section>
        )}

        {/* ─── Multipliers (DCA Simple only — only show if any non-flat) ─── */}
        {isDcaSimple && (priceMultMode !== 'flat' || sizeMultMode !== 'flat') && (
          <Section icon={<Sparkles className="h-3 w-3" />} title="Multipliers">
            {priceMultMode !== 'flat' && priceMult !== null && (
              <Row
                label="Price gap"
                value={
                  <span className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] uppercase">{priceMultMode}</Badge>
                    <span className="font-mono">
                      {priceMultMode === 'percent' ? `+${priceMult}% / rung` : `+$${priceMult} / rung`}
                    </span>
                  </span>
                }
              />
            )}
            {sizeMultMode !== 'flat' && sizeMult !== null && (
              <Row
                label="Order size"
                value={
                  <span className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] uppercase">{sizeMultMode}</Badge>
                    <span className="font-mono">
                      {sizeMultMode === 'percent' ? `+${sizeMult}% / rung` : `+$${sizeMult} / rung`}
                    </span>
                  </span>
                }
              />
            )}
          </Section>
        )}

        {/* ─── Take profit (DCA Simple only) ─── */}
        {isDcaSimple && takeProfit !== null && (
          <Section icon={<Target className="h-3 w-3" />} title="Profit target">
            <Row
              label={direction === 'SELL' ? 'BB target' : 'TP target'}
              value={
                <span className="font-mono">
                  avg {direction === 'SELL' ? '−' : '+'} ${formatNumber(takeProfit, { maximumFractionDigits: 4 })}
                </span>
              }
            />
          </Section>
        )}

        {/* ─── Anchor / start price ─── */}
        {customStartPrice !== null && (
          <Section icon={<Coins className="h-3 w-3" />} title="Custom anchor">
            <Row label="Custom start price"
              value={`$${formatNumber(customStartPrice, { maximumFractionDigits: 2 })}`} />
          </Section>
        )}

        {/* ─── Timing constraints ─── */}
        {(cooldownMinutes !== null && cooldownMinutes > 0)
          || (recenterAfterMinutes !== null && recenterAfterMinutes > 0)
          || (durationMinutes !== null && durationMinutes > 0) ? (
          <Section icon={<Timer className="h-3 w-3" />} title="Timing">
            {cooldownMinutes !== null && cooldownMinutes > 0 && (
              <Row
                label="Cooldown / cycle"
                value={
                  <span className="flex items-center gap-1.5">
                    <Hourglass className="h-3 w-3 text-blue-500" />
                    <span className="font-mono">{cooldownMinutes} min</span>
                  </span>
                }
              />
            )}
            {recenterAfterMinutes !== null && recenterAfterMinutes > 0 && (
              <Row
                label="Recenter if idle"
                value={
                  <span className="flex items-center gap-1.5">
                    <span className="text-orange-500">↻</span>
                    <span className="font-mono">{recenterAfterMinutes} min</span>
                  </span>
                }
              />
            )}
            {durationMinutes !== null && durationMinutes > 0 && (
              <Row label="Auto-stop after" value={`${durationMinutes} min total`} />
            )}
          </Section>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Section({ icon, title, children }: {
  icon?: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        {icon}{title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums text-right ${muted ? 'text-muted-foreground' : 'text-foreground font-semibold'}`}>
        {value}
      </span>
    </div>
  );
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
