'use client';
import { useState, useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Pure-client P&L simulator. Asks: "If the market moved to X, what would my
 * unrealized P&L be?" Uses the same formula the server uses:
 *   unrealized = (hypoPrice − avgCost) × signedHeld
 */
export function WhatIfSimulator({ live, quoteAsset }: { live: BotLive; quoteAsset: string }) {
  const avg = live.pnl.breakEvenPrice;
  const signed = live.pnl.signedHeld;
  const mkt = live.marketPrice ? Number(live.marketPrice) : null;
  const realized = live.pnl.realized;

  const [hypoPrice, setHypoPrice] = useState<string>(mkt ? mkt.toFixed(4) : '');
  const hypo = Number(hypoPrice);

  const result = useMemo(() => {
    if (!avg || !Number.isFinite(hypo) || hypo <= 0 || signed === 0) return null;
    const unreal = (hypo - avg) * signed;
    const total = realized + unreal;
    const pctMove = mkt && mkt > 0 ? ((hypo - mkt) / mkt) * 100 : null;
    return { unreal, total, pctMove };
  }, [hypo, avg, signed, realized, mkt]);

  if (!avg || signed === 0) {
    return (
      <Card className="shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            What-if Simulator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">
            Needs an open position to simulate. Currently no held inventory.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" />
          What-if Simulator
        </CardTitle>
        <CardDescription className="text-xs">
          Avg cost <span className="font-mono">{formatNumber(avg)}</span> · held <span className="font-mono">{formatNumber(Math.abs(signed), { maximumFractionDigits: 6 })}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">If price moved to:</span>
          <Input
            type="number"
            step="any"
            value={hypoPrice}
            onChange={(e) => setHypoPrice(e.target.value)}
            className="font-mono mt-1"
          />
        </label>

        {result ? (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border bg-muted/20 p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Floating P&L</div>
              <div className={`font-mono font-bold text-base ${result.unreal >= 0 ? 'text-success' : 'text-destructive'}`}>
                {result.unreal >= 0 ? '+' : ''}{formatNumber(result.unreal, { maximumFractionDigits: 4 })}
              </div>
              <div className="text-[10px] text-muted-foreground">{quoteAsset}</div>
            </div>
            <div className="rounded-md border bg-muted/20 p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total P&L</div>
              <div className={`font-mono font-bold text-base ${result.total >= 0 ? 'text-success' : 'text-destructive'}`}>
                {result.total >= 0 ? '+' : ''}{formatNumber(result.total, { maximumFractionDigits: 4 })}
              </div>
              <div className="text-[10px] text-muted-foreground">{quoteAsset}</div>
            </div>
            {result.pctMove !== null && (
              <div className="col-span-2 text-[11px] text-muted-foreground">
                Market move:{' '}
                <span className={result.pctMove >= 0 ? 'text-success' : 'text-destructive'}>
                  {result.pctMove >= 0 ? '+' : ''}{result.pctMove.toFixed(3)}%
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">Enter a price to simulate.</p>
        )}
      </CardContent>
    </Card>
  );
}
