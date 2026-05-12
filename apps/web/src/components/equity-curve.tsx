'use client';
import { TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Equity curve: cumulative realized + current unrealized as a single line.
 * Last data point is "now" with realized + live unrealized.
 *
 * Lightweight inline SVG — no chart library dependency.
 */
export function EquityCurve({ live }: { live: BotLive }) {
  const series = live.pnl.series ?? [];
  if (series.length === 0) {
    return (
      <Card className="shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Equity Curve
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground italic">No closed cycles yet.</p>
        </CardContent>
      </Card>
    );
  }

  // Append a "now" point combining realized + unrealized.
  const liveTotal = live.pnl.realized + live.pnl.unrealized;
  const points = [
    ...series,
    { ts: Date.now(), pnl: liveTotal },
  ];

  const w = 600, h = 140, pad = 8;
  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.pnl);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
  const xR = maxX - minX || 1, yR = maxY - minY || 1;
  const toX = (t: number) => pad + ((t - minX) / xR) * (w - 2 * pad);
  const toY = (v: number) => h - pad - ((v - minY) / yR) * (h - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.ts).toFixed(2)} ${toY(p.pnl).toFixed(2)}`).join(' ');
  const zeroY = toY(0);

  const final = points[points.length - 1].pnl;
  const tone = final >= 0 ? 'text-success' : 'text-destructive';

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Equity Curve
        </CardTitle>
        <CardDescription className="text-xs">
          Realized + Unrealized over time · current{' '}
          <span className={`font-mono font-semibold ${tone}`}>
            {final >= 0 ? '+' : ''}{formatNumber(final, { maximumFractionDigits: 4 })}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
          {/* zero line */}
          <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY}
            stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />
          <path d={path} fill="none"
            stroke={final >= 0 ? '#22c55e' : '#ef4444'}
            strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {/* end dot */}
          <circle
            cx={toX(points[points.length - 1].ts)}
            cy={toY(final)}
            r="3"
            fill={final >= 0 ? '#22c55e' : '#ef4444'}
          />
        </svg>
      </CardContent>
    </Card>
  );
}
