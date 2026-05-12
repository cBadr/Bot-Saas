'use client';
import { TrendingUp, TrendingDown, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Prominent banner for the symbol's live market: current price, 24h change,
 * high/low, and the bot's avg cost vs. distance to the closest BUY/SELL rung.
 *
 * Designed to be the visual anchor of the bot page — replaces the cramped
 * sticky strip + duplicated KPI tile.
 */
export function MarketPriceBanner({ live, baseAsset, quoteAsset }: {
  live: BotLive;
  baseAsset: string;
  quoteAsset: string;
}) {
  const price = live.marketPrice ? Number(live.marketPrice) : null;
  const m = live.market;
  const avg = live.pnl.breakEvenPrice;
  const change = m?.changePct24h ?? null;
  const tone = change === null ? 'neutral' : change >= 0 ? 'up' : 'down';

  // % distance: market vs avg cost (positive = market above avg = profitable for long).
  const vsAvgPct = (price !== null && avg !== null && avg > 0)
    ? ((price - avg) / avg) * 100 * (live.pnl.signedHeld >= 0 ? 1 : -1)
    : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="grid lg:grid-cols-[1.2fr_1fr_1fr] gap-px bg-border">
          {/* Big price column */}
          <div className="p-5 bg-background">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <span className="font-mono">{live.symbol}</span>
              <span>·</span>
              <span>{baseAsset} / {quoteAsset}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-3 flex-wrap">
              <span className={`text-4xl font-bold tabular-nums ${
                tone === 'up' ? 'text-success' : tone === 'down' ? 'text-destructive' : ''
              }`}>
                {price !== null ? formatNumber(price) : '—'}
              </span>
              {m && (
                <span className={`text-sm font-mono flex items-center gap-1 ${
                  tone === 'up' ? 'text-success' : 'text-destructive'
                }`}>
                  {tone === 'up' ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {m.changePct24h >= 0 ? '+' : ''}{m.changePct24h.toFixed(2)}%
                  <span className="text-muted-foreground ml-0.5">
                    ({m.change24h >= 0 ? '+' : ''}{formatNumber(m.change24h)})
                  </span>
                </span>
              )}
            </div>
            {m && (
              <div className="mt-3 grid grid-cols-3 gap-3 text-[11px]">
                <Mini label="24h High" value={formatNumber(m.high24h)} />
                <Mini label="24h Low"  value={formatNumber(m.low24h)} />
                <Mini label="24h Vol"  value={`${formatNumber(m.quoteVolume24h, { maximumFractionDigits: 0 })} ${quoteAsset}`} />
              </div>
            )}
          </div>

          {/* Position vs market */}
          <div className="p-5 bg-background">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Your position</div>
            {avg !== null ? (
              <>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tabular-nums">{formatNumber(avg)}</span>
                  <span className="text-[11px] text-muted-foreground">avg cost</span>
                </div>
                {vsAvgPct !== null && (
                  <div className={`mt-1 text-sm font-mono ${vsAvgPct >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {vsAvgPct >= 0 ? '+' : ''}{vsAvgPct.toFixed(2)}% vs market
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                  <Mini label="Held" value={`${formatNumber(Math.abs(live.pnl.signedHeld), { maximumFractionDigits: 6 })} ${baseAsset}`} />
                  <Mini label="Notional" value={`${formatNumber(live.pnl.actualInvested, { maximumFractionDigits: 2 })} ${quoteAsset}`} />
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground italic">No open position.</p>
            )}
          </div>

          {/* Next rungs */}
          <div className="p-5 bg-background">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Next fills</div>
            <div className="mt-2 space-y-2">
              <RungLine
                icon={<ArrowDownToLine className="h-4 w-4 text-success" />}
                side="BUY"
                rung={live.derived.nextBuy}
                tone="success"
              />
              <RungLine
                icon={<ArrowUpFromLine className="h-4 w-4 text-destructive" />}
                side="SELL"
                rung={live.derived.nextSell}
                tone="destructive"
              />
            </div>
            <div className="mt-3 text-[10px] text-muted-foreground">
              {live.derived.openBuyCount}× BUY · {live.derived.openSellCount}× SELL open
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono tabular-nums">{value}</div>
    </div>
  );
}

function RungLine({ icon, side, rung, tone }: {
  icon: React.ReactNode;
  side: 'BUY' | 'SELL';
  rung: { price: number; distance: number; distancePct: number } | null;
  tone: 'success' | 'destructive';
}) {
  if (!rung) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>No open {side}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="flex items-center gap-2">
        {icon}
        <span className={`font-mono font-semibold ${tone === 'success' ? 'text-success' : 'text-destructive'}`}>
          {formatNumber(rung.price)}
        </span>
      </div>
      <span className="text-muted-foreground font-mono">
        {rung.distancePct.toFixed(2)}% away
      </span>
    </div>
  );
}
