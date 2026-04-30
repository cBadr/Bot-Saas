'use client';
import { BarChart3, Repeat, Coins, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Performance metrics: cycles, capital deployed, expected & estimated yields.
 *
 * Reads everything from `live.derived` (server-computed) so client doesn't
 * re-implement multiplier math.
 */
export function PerformanceCard({ live, quoteAsset }: { live: BotLive; quoteAsset: string }) {
  const d = live.derived;
  const p = live.pnl;
  const roiPct = (d.totalInvestment && d.totalInvestment > 0)
    ? (p.realized / d.totalInvestment) * 100
    : null;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Performance
        </CardTitle>
        <CardDescription className="text-xs">
          Cycle stats, capital deployed, and yield projections.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Cycles */}
        <Section icon={<Repeat className="h-3 w-3" />} title="Cycles">
          <Row label="Completed" value={
            <span className="text-base">{p.cyclesCompleted}</span>
          } />
          {p.cyclesCompleted > 0 && (
            <Row
              label="Avg per cycle"
              value={
                <span className={p.avgPerCycle >= 0 ? 'text-success' : 'text-destructive'}>
                  {p.avgPerCycle >= 0 ? '+' : ''}{formatNumber(p.avgPerCycle, { maximumFractionDigits: 4 })}
                  <span className="text-[10px] text-muted-foreground ml-1">{quoteAsset}</span>
                </span>
              }
            />
          )}
          {d.expectedPerCycle !== null && d.expectedPerCycle > 0 && (
            <Row
              label="Expected per cycle"
              value={
                <span className="font-mono">
                  ~{formatNumber(d.expectedPerCycle, { maximumFractionDigits: 4 })}
                  <span className="text-[10px] text-muted-foreground ml-1">{quoteAsset}</span>
                </span>
              }
            />
          )}
        </Section>

        {/* Capital */}
        <Section icon={<Coins className="h-3 w-3" />} title="Capital">
          {d.totalInvestment !== null && (
            <Row
              label="Total investment"
              value={
                <span className="font-semibold">
                  ${formatNumber(d.totalInvestment, { maximumFractionDigits: 2 })}
                  <span className="text-[10px] text-muted-foreground ml-1">{quoteAsset}</span>
                </span>
              }
            />
          )}
          <Row
            label="Total volume traded"
            value={
              <span className="font-semibold">
                ${formatNumber(live.volume.totalQuote, { maximumFractionDigits: 2 })}
                <span className="text-[10px] text-muted-foreground ml-1">{quoteAsset}</span>
              </span>
            }
          />
          <Row
            label="Total trades"
            value={String(live.volume.tradeCount)}
          />
          {roiPct !== null && (
            <Row
              label="ROI (realized / invested)"
              value={
                <span className={roiPct >= 0 ? 'text-success' : 'text-destructive'}>
                  {roiPct >= 0 ? '+' : ''}{roiPct.toFixed(3)}%
                </span>
              }
            />
          )}
        </Section>

        {/* Projections (DCA Simple — full ladder fill scenario) */}
        {d.estimatedProfitAllFill !== null && d.estimatedProfitAllFill > 0 && (
          <Section icon={<Sparkles className="h-3 w-3" />} title="Projection">
            <Row
              label="If ALL rungs fill"
              value={
                <span className="font-semibold text-success">
                  +{formatNumber(d.estimatedProfitAllFill, { maximumFractionDigits: 4 })}
                  <span className="text-[10px] text-muted-foreground ml-1">{quoteAsset}</span>
                </span>
              }
            />
            <p className="text-[10px] text-muted-foreground italic mt-1">
              Maximum theoretical profit if every ladder rung fills and the
              counter (TP/BB) closes them all. Actual outcome may be lower if
              the cycle closes before all rungs fill.
            </p>
          </Section>
        )}
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-right text-foreground font-semibold">
        {value}
      </span>
    </div>
  );
}
