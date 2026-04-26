'use client';
import { useEffect, useState } from 'react';
import { TrendingUp, ArrowUp, ArrowDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';

export interface PreviewLevel {
  index: number;
  price: number;
  /** quote amount allocated for this level */
  quoteAmount: number;
  /** base quantity at this level (= quoteAmount / price) */
  baseQty: number;
  side: 'BUY' | 'SELL' | 'BOTH';
}

export interface PreviewProps {
  symbol: string;
  /** Current market price (parent can pass to avoid duplicate fetches). */
  marketPrice?: number;
  levels: PreviewLevel[];
  /** Optional summary lines below the chart */
  totals?: { label: string; value: string }[];
  emptyMessage?: string;
  /** Optional custom anchor price — drawn as a distinct marker. */
  anchorPrice?: number;
  /** If set, shows a banner about the initial market BUY bootstrap. */
  initialPositionPct?: number;
  /** If set, shows a banner that grid will use existing wallet balance. */
  useExistingInventory?: boolean;
  existingInventoryPct?: number;
}

/**
 * Live SVG preview for bot orders. Polished, professional layout:
 * - Tall canvas with thick BUY/SELL bars
 * - Dedicated price axis with minor gridlines
 * - Large readable labels with quote $ + base qty
 * - Distinct anchor + market price markers
 */
export function BotPreview({
  symbol, marketPrice, levels, totals, emptyMessage,
  anchorPrice, initialPositionPct, useExistingInventory, existingInventoryPct,
}: PreviewProps) {
  const [livePrice, setLivePrice] = useState<number | undefined>(marketPrice);

  useEffect(() => {
    if (marketPrice !== undefined) { setLivePrice(marketPrice); return; }
    if (!symbol) return;
    let cancelled = false;
    const tick = () => {
      fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`)
        .then((r) => r.json())
        .then((d: { price?: string }) => {
          if (!cancelled && d.price) setLivePrice(Number(d.price));
        })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [symbol, marketPrice]);

  const buyCount = levels.filter((l) => l.side === 'BUY').length;
  const sellCount = levels.filter((l) => l.side === 'SELL').length;

  const sortedLevels = [...levels].sort((a, b) => b.price - a.price);
  const allPrices = [
    ...sortedLevels.map((l) => l.price),
    ...(livePrice !== undefined ? [livePrice] : []),
    ...(anchorPrice !== undefined ? [anchorPrice] : []),
  ];
  const minPrice = allPrices.length ? Math.min(...allPrices) : 0;
  const maxPrice = allPrices.length ? Math.max(...allPrices) : 1;
  const range = maxPrice - minPrice || 1;
  const padding = range * 0.06;
  const yMin = minPrice - padding;
  const yMax = maxPrice + padding;
  const yRange = yMax - yMin;

  // Larger, more readable canvas
  const W = 720;
  const H = 540;
  const padL = 88;
  const padR = 168;
  const padT = 24;
  const padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const yFor = (p: number): number => padT + ((yMax - p) / yRange) * innerH;

  // Order-size scale → bar thickness (4px to 14px) — much beefier than before
  const sizeMin = levels.length ? Math.min(...levels.map((l) => l.quoteAmount)) : 0;
  const sizeMax = levels.length ? Math.max(...levels.map((l) => l.quoteAmount)) : 1;
  const sizeRange = sizeMax - sizeMin || 1;
  const thicknessFor = (q: number): number => 4 + ((q - sizeMin) / sizeRange) * 10;

  // Y-axis tick marks (~6 evenly spaced)
  const ticks: number[] = [];
  if (allPrices.length) {
    for (let i = 0; i <= 5; i++) ticks.push(yMin + (yRange * i) / 5);
  }

  return (
    <Card className="sticky top-20 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Live preview
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {buyCount > 0 && (
              <Badge variant="success" className="text-[10px] gap-1">
                <ArrowDown className="h-3 w-3" />{buyCount} BUY
              </Badge>
            )}
            {sellCount > 0 && (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <ArrowUp className="h-3 w-3" />{sellCount} SELL
              </Badge>
            )}
            <Badge variant="outline" className="font-mono text-[10px]">{symbol || '—'}</Badge>
          </div>
        </div>
        <CardDescription className="text-xs">
          Visual map of orders this bot will place. Bar thickness = order size.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!levels.length ? (
          <div className="h-[540px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded">
            {emptyMessage ?? 'Fill the form to see a live preview.'}
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
            {/* Background grid (horizontal tick lines) */}
            {ticks.map((t, i) => (
              <line
                key={`t${i}`}
                x1={padL} x2={W - padR}
                y1={yFor(t)} y2={yFor(t)}
                stroke="hsl(var(--border))"
                strokeWidth={0.5}
                strokeDasharray="2 4"
                opacity={0.5}
              />
            ))}
            {/* Y-axis tick labels */}
            {ticks.map((t, i) => (
              <text
                key={`tl${i}`}
                x={padL - 8} y={yFor(t) + 4}
                fontSize={10} textAnchor="end"
                fill="hsl(var(--muted-foreground))"
                fontFamily="monospace"
              >
                {formatNumber(t, { maximumFractionDigits: 2 })}
              </text>
            ))}

            {/* Y-axis line */}
            <line x1={padL} y1={padT} x2={padL} y2={H - padB}
              stroke="hsl(var(--border))" strokeWidth={1} />

            {/* Order level bars */}
            {sortedLevels.map((lvl, i) => {
              const y = yFor(lvl.price);
              const isBuy = lvl.side === 'BUY';
              const color = isBuy ? 'hsl(var(--success))'
                : lvl.side === 'SELL' ? 'hsl(var(--destructive))'
                : 'hsl(var(--primary))';
              const thickness = thicknessFor(lvl.quoteAmount);
              return (
                <g key={i}>
                  {/* Bar (rounded thick line) */}
                  <line
                    x1={padL + 2}
                    y1={y}
                    x2={W - padR - 8}
                    y2={y}
                    stroke={color}
                    strokeWidth={thickness}
                    strokeLinecap="round"
                    opacity={0.92}
                  />
                  {/* Side icon at the start of the bar */}
                  <circle
                    cx={padL + 2}
                    cy={y}
                    r={Math.max(4, thickness / 2 + 1)}
                    fill={color}
                  />
                  {/* Right-side label panel */}
                  <rect
                    x={W - padR}
                    y={y - 11}
                    width={padR - 6}
                    height={22}
                    rx={4}
                    fill={color}
                    fillOpacity={0.08}
                    stroke={color}
                    strokeOpacity={0.35}
                    strokeWidth={1}
                  />
                  <text
                    x={W - padR + 8}
                    y={y - 1}
                    fontSize={10}
                    fontWeight={600}
                    fill={color}
                    fontFamily="monospace"
                  >
                    ${formatNumber(lvl.quoteAmount, { maximumFractionDigits: 2 })}
                  </text>
                  <text
                    x={W - padR + 8}
                    y={y + 10}
                    fontSize={9}
                    fill="hsl(var(--muted-foreground))"
                    fontFamily="monospace"
                  >
                    {formatNumber(lvl.baseQty, { maximumFractionDigits: 8 })}
                  </text>
                </g>
              );
            })}

            {/* Anchor marker */}
            {anchorPrice !== undefined && anchorPrice !== livePrice && (
              <g>
                <line
                  x1={padL}
                  y1={yFor(anchorPrice)}
                  x2={W - padR - 4}
                  y2={yFor(anchorPrice)}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  strokeDasharray="8 4"
                  opacity={0.85}
                />
                <rect
                  x={padL - 78}
                  y={yFor(anchorPrice) - 10}
                  width={72}
                  height={20}
                  fill="hsl(var(--primary))"
                  rx={4}
                />
                <text
                  x={padL - 42}
                  y={yFor(anchorPrice) + 4}
                  fontSize={10}
                  textAnchor="middle"
                  fill="hsl(var(--primary-foreground))"
                  fontFamily="monospace"
                  fontWeight={700}
                >
                  ⚓ {formatNumber(anchorPrice, { maximumFractionDigits: 2 })}
                </text>
              </g>
            )}

            {/* Market price marker */}
            {livePrice !== undefined && (
              <g>
                <line
                  x1={padL}
                  y1={yFor(livePrice)}
                  x2={W - padR - 4}
                  y2={yFor(livePrice)}
                  stroke="hsl(var(--foreground))"
                  strokeWidth={2}
                  opacity={0.95}
                />
                <rect
                  x={padL - 78}
                  y={yFor(livePrice) - 10}
                  width={72}
                  height={20}
                  fill="hsl(var(--foreground))"
                  rx={4}
                />
                <text
                  x={padL - 42}
                  y={yFor(livePrice) + 4}
                  fontSize={10}
                  textAnchor="middle"
                  fill="hsl(var(--background))"
                  fontFamily="monospace"
                  fontWeight={700}
                >
                  ● {formatNumber(livePrice, { maximumFractionDigits: 2 })}
                </text>
              </g>
            )}
          </svg>
        )}

        {useExistingInventory && (
          <div className="mt-3 rounded-md border border-success/40 bg-success/5 px-3 py-2 text-[11px] flex items-start gap-2">
            <span className="text-success font-semibold whitespace-nowrap">💰 Existing</span>
            <span className="text-muted-foreground">
              Bot will use {existingInventoryPct ?? 100}% of your free base-coin balance
              to seed SELL orders above anchor — no upfront market BUY.
            </span>
          </div>
        )}
        {!useExistingInventory && initialPositionPct !== undefined && initialPositionPct > 0 && (
          <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-[11px] flex items-start gap-2">
            <span className="text-primary font-semibold whitespace-nowrap">⚡ Bootstrap</span>
            <span className="text-muted-foreground">
              Bot will market-BUY {initialPositionPct}% of investment up-front to seed inventory,
              enabling SELL orders above anchor on day-1.
            </span>
          </div>
        )}

        {totals && totals.length > 0 && (
          <div className="mt-4 pt-3 border-t space-y-1.5">
            {totals.map((t, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t.label}</span>
                <span className="font-mono font-medium">{t.value}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-1 rounded-sm bg-success" />BUY
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-1 rounded-sm bg-destructive" />SELL
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-px bg-foreground" />Market
          </span>
          {anchorPrice !== undefined && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed border-primary" />Anchor
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
