'use client';
import { Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { BotLive } from '@/lib/queries';

/**
 * Shows the gap between planned ladder vs what's actually working.
 * The bot config says N rungs at order size X — but how many are truly
 * placed vs. rejected by post-only, blocked by balance, etc.
 */
export function DesiredVsActualCard({ live }: { live: BotLive }) {
  const planned = live.config.gridLevels ?? live.orders.length;
  const breakdown = live.integrity.breakdown ?? {};
  const open = breakdown['open'] ?? 0;
  const pending = breakdown['pending'] ?? 0;
  const failedCategories: Array<[string, number]> = [];
  for (const [k, v] of Object.entries(breakdown)) {
    if (k !== 'open' && k !== 'pending' && v > 0) failedCategories.push([k, v]);
  }
  const healthPct = planned > 0 ? (open / planned) * 100 : 0;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          Plan vs Reality
        </CardTitle>
        <CardDescription className="text-xs">
          Planned <span className="font-mono">{planned}</span> rungs ·{' '}
          Working <span className="font-mono">{open}</span> ·{' '}
          Health{' '}
          <span className={healthPct >= 90 ? 'text-success' : healthPct >= 60 ? 'text-amber-500' : 'text-destructive'}>
            {healthPct.toFixed(0)}%
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Health bar */}
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all ${healthPct >= 90 ? 'bg-success' : healthPct >= 60 ? 'bg-amber-500' : 'bg-destructive'}`}
            style={{ width: `${Math.min(100, Math.max(0, healthPct))}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat label="Open" value={open} tone="positive" />
          <Stat label="Pending" value={pending} tone="muted" />
        </div>

        {failedCategories.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mt-2">
              Blocked rungs
            </div>
            {failedCategories.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <Badge variant="outline" className="text-[10px] font-mono text-destructive">
                  {k}
                </Badge>
                <span className="font-mono font-semibold text-destructive">{v}</span>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground italic mt-1">
              Most blocks are transient — the integrity loop retries every ~60s.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'positive' | 'muted' }) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono font-bold text-lg ${tone === 'positive' ? 'text-success' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}
