'use client';
import { TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Live grid visualization. Reads bot state in real time and shows:
 *   - 🟢 open orders (BUY=green, SELL=red)
 *   - ⚠️ failed orders (yellow, with hover tooltip showing the error category)
 *   - 📍 live market price marker
 *   - ⚓ original anchor (initialStartPrice) marker
 */
export function LiveGrid({ live }: { live: BotLive }) {
  const orders = [...live.orders].sort((a, b) => Number(b.price) - Number(a.price));
  const market = live.marketPrice ? Number(live.marketPrice) : undefined;
  const anchor = live.initialStartPrice ? Number(live.initialStartPrice) : undefined;

  const allPrices = [
    ...orders.map((o) => Number(o.price)),
    ...(market !== undefined ? [market] : []),
    ...(anchor !== undefined ? [anchor] : []),
  ];
  const minPrice = allPrices.length ? Math.min(...allPrices) : 0;
  const maxPrice = allPrices.length ? Math.max(...allPrices) : 1;
  const range = maxPrice - minPrice || 1;
  const padding = range * 0.06;
  const yMin = minPrice - padding;
  const yMax = maxPrice + padding;
  const yRange = yMax - yMin;

  const W = 720;
  const H = 540;
  const padL = 88;
  const padR = 200;
  const padT = 24;
  const padB = 32;
  const innerH = H - padT - padB;
  const yFor = (p: number) => padT + ((yMax - p) / yRange) * innerH;

  const buyOpen = orders.filter((o) => o.side === 'BUY' && o.status === 'open').length;
  const sellOpen = orders.filter((o) => o.side === 'SELL' && o.status === 'open').length;
  const failed = orders.filter((o) => o.status !== 'open').length;

  // Y-axis tick marks
  const ticks: number[] = [];
  if (allPrices.length) for (let i = 0; i <= 5; i++) ticks.push(yMin + (yRange * i) / 5);

  const colorFor = (o: BotLive['orders'][number]): string => {
    if (o.status !== 'open') return 'hsl(var(--warning, 38 92% 50%))';
    return o.side === 'BUY' ? 'hsl(var(--success))' : 'hsl(var(--destructive))';
  };

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Live grid
          </CardTitle>
          <div className="flex items-center gap-1.5 flex-wrap">
            {buyOpen > 0 && <Badge variant="success" className="text-[10px]">{buyOpen} BUY open</Badge>}
            {sellOpen > 0 && <Badge variant="destructive" className="text-[10px]">{sellOpen} SELL open</Badge>}
            {failed > 0 && <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-700 dark:text-yellow-400">{failed} pending repair</Badge>}
            <Badge variant="outline" className="font-mono text-[10px]">{live.symbol}</Badge>
          </div>
        </div>
        <CardDescription className="text-xs">
          Real-time map of orders on Binance. ⚠️ markers are levels still being repaired by the integrity loop.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {orders.length === 0 ? (
          <div className="h-[540px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded">
            No live grid state yet — start the bot or wait a few seconds.
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
            {/* gridlines */}
            {ticks.map((t, i) => (
              <line key={`t${i}`} x1={padL} x2={W - padR} y1={yFor(t)} y2={yFor(t)}
                stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="2 4" opacity={0.5} />
            ))}
            {ticks.map((t, i) => (
              <text key={`tl${i}`} x={padL - 8} y={yFor(t) + 4} fontSize={10} textAnchor="end"
                fill="hsl(var(--muted-foreground))" fontFamily="monospace">
                {formatNumber(t, { maximumFractionDigits: 2 })}
              </text>
            ))}
            <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="hsl(var(--border))" strokeWidth={1} />

            {/* orders */}
            {orders.map((o, i) => {
              const y = yFor(Number(o.price));
              const color = colorFor(o);
              const isOpen = o.status === 'open';
              return (
                <g key={i}>
                  <line x1={padL + 2} y1={y} x2={W - padR - 8} y2={y}
                    stroke={color} strokeWidth={isOpen ? 6 : 3}
                    strokeLinecap="round"
                    strokeDasharray={isOpen ? undefined : '6 4'}
                    opacity={isOpen ? 0.92 : 0.7} />
                  <circle cx={padL + 2} cy={y} r={isOpen ? 5 : 3.5} fill={color} />
                  <rect x={W - padR} y={y - 11} width={padR - 6} height={22} rx={4}
                    fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={0.35} />
                  <text x={W - padR + 8} y={y - 1} fontSize={10} fontWeight={600}
                    fill={color} fontFamily="monospace">
                    {o.side} {formatNumber(o.quantity, { maximumFractionDigits: 6 })}
                  </text>
                  <text x={W - padR + 8} y={y + 10} fontSize={9}
                    fill="hsl(var(--muted-foreground))" fontFamily="monospace">
                    {isOpen ? `@ ${formatNumber(o.price, { maximumFractionDigits: 2 })}` : `${o.status}${o.errorCategory ? ` · ${o.errorCategory}` : ''}`}
                  </text>
                  {!isOpen && o.errorMsg && (
                    <title>{`${o.errorCategory ?? o.status}${o.errorCode ? ` (${o.errorCode})` : ''}: ${o.errorMsg}`}</title>
                  )}
                </g>
              );
            })}

            {/* anchor */}
            {anchor !== undefined && anchor !== market && (
              <g>
                <line x1={padL} y1={yFor(anchor)} x2={W - padR - 4} y2={yFor(anchor)}
                  stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="8 4" opacity={0.85} />
                <rect x={padL - 78} y={yFor(anchor) - 10} width={72} height={20}
                  fill="hsl(var(--primary))" rx={4} />
                <text x={padL - 42} y={yFor(anchor) + 4} fontSize={10} textAnchor="middle"
                  fill="hsl(var(--primary-foreground))" fontFamily="monospace" fontWeight={700}>
                  ⚓ {formatNumber(anchor, { maximumFractionDigits: 2 })}
                </text>
              </g>
            )}

            {/* live market */}
            {market !== undefined && (
              <g>
                <line x1={padL} y1={yFor(market)} x2={W - padR - 4} y2={yFor(market)}
                  stroke="hsl(var(--foreground))" strokeWidth={2} opacity={0.95} />
                <rect x={padL - 78} y={yFor(market) - 10} width={72} height={20}
                  fill="hsl(var(--foreground))" rx={4} />
                <text x={padL - 42} y={yFor(market) + 4} fontSize={10} textAnchor="middle"
                  fill="hsl(var(--background))" fontFamily="monospace" fontWeight={700}>
                  ● {formatNumber(market, { maximumFractionDigits: 2 })}
                </text>
              </g>
            )}
          </svg>
        )}

        <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-1 rounded-sm bg-success" />BUY open</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-1 rounded-sm bg-destructive" />SELL open</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 rounded-sm bg-yellow-500" style={{ borderTop: '1.5px dashed' }} />pending repair</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-px bg-foreground" />Market</span>
          {anchor !== undefined && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed border-primary" />Anchor
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
