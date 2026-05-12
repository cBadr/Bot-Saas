'use client';
import { BarChart3, Repeat, Coins, Sparkles, Trophy, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

export function PerformanceCard({ live, quoteAsset }: { live: BotLive; quoteAsset: string }) {
  const d = live.derived;
  const p = live.pnl;
  // True ROI uses actual deployed capital; falls back to planned investment.
  const roiPct = p.roi !== null
    ? p.roi
    : (d.totalInvestment && d.totalInvestment > 0 ? ((p.realized + p.unrealized) / d.totalInvestment) * 100 : null);

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
          {p.actualInvested > 0 && (
            <Row
              label="Capital deployed"
              value={
                <span className="font-semibold">
                  ${formatNumber(p.actualInvested, { maximumFractionDigits: 2 })}
                  <span className="text-[10px] text-muted-foreground ml-1">{quoteAsset}</span>
                </span>
              }
            />
          )}
          {roiPct !== null && (
            <Row
              label={p.roi !== null ? 'ROI (total / deployed)' : 'ROI (total / planned)'}
              value={
                <span className={roiPct >= 0 ? 'text-success' : 'text-destructive'}>
                  {roiPct >= 0 ? '+' : ''}{roiPct.toFixed(3)}%
                </span>
              }
            />
          )}
          {live.volume.totalFees > 0 && (
            <Row
              label="Fees paid"
              value={
                <span className="text-muted-foreground">
                  {formatNumber(live.volume.totalFees, { maximumFractionDigits: 6 })}
                  <span className="text-[10px] ml-1">{live.volume.feeAsset ?? ''}</span>
                </span>
              }
            />
          )}
        </Section>

        {/* Win/Loss analytics */}
        {(p.wins > 0 || p.losses > 0) && (
          <Section icon={<Trophy className="h-3 w-3" />} title="Win/Loss">
            <Row
              label="Win rate"
              value={
                <span className={p.winRate !== null && p.winRate >= 0.5 ? 'text-success' : 'text-muted-foreground'}>
                  {p.winRate !== null ? `${(p.winRate * 100).toFixed(1)}%` : '—'}
                  <span className="text-[10px] text-muted-foreground ml-1">
                    ({p.wins}W / {p.losses}L)
                  </span>
                </span>
              }
            />
            {p.profitFactor !== null && (
              <Row
                label="Profit factor"
                value={
                  <span className={p.profitFactor >= 1 ? 'text-success' : 'text-destructive'}>
                    {p.profitFactor.toFixed(2)}
                  </span>
                }
              />
            )}
            {p.avgWin > 0 && (
              <Row
                label="Avg win"
                value={
                  <span className="text-success">
                    +{formatNumber(p.avgWin, { maximumFractionDigits: 4 })}
                    <span className="text-[10px] text-muted-foreground ml-1">{quoteAsset}</span>
                  </span>
                }
              />
            )}
            {p.avgLoss < 0 && (
              <Row
                label="Avg loss"
                value={
                  <span className="text-destructive">
                    {formatNumber(p.avgLoss, { maximumFractionDigits: 4 })}
                    <span className="text-[10px] text-muted-foreground ml-1">{quoteAsset}</span>
                  </span>
                }
              />
            )}
            {p.bestCycle > 0 && (
              <Row
                label="Best cycle"
                value={
                  <span className="text-success">
                    +{formatNumber(p.bestCycle, { maximumFractionDigits: 4 })}
                  </span>
                }
              />
            )}
            {p.worstCycle < 0 && (
              <Row
                label="Worst cycle"
                value={
                  <span className="text-destructive">
                    {formatNumber(p.worstCycle, { maximumFractionDigits: 4 })}
                  </span>
                }
              />
            )}
          </Section>
        )}

        {/* Drawdown + Sharpe (risk) */}
        {(p.maxDrawdownAbs > 0 || p.sharpe !== null) && (
          <Section icon={<TrendingDown className="h-3 w-3" />} title="Risk">
            {p.maxDrawdownAbs > 0 && (
              <Row
                label="Max drawdown"
                value={
                  <span className="text-destructive">
                    −{formatNumber(p.maxDrawdownAbs, { maximumFractionDigits: 4 })}
                    <span className="text-[10px] text-muted-foreground ml-1">
                      ({p.maxDrawdownPct.toFixed(1)}%)
                    </span>
                  </span>
                }
              />
            )}
            {p.sharpe !== null && (
              <Row
                label="Sharpe (cycle-annualized)"
                value={
                  <span className={p.sharpe >= 1 ? 'text-success' : p.sharpe >= 0 ? 'text-muted-foreground' : 'text-destructive'}>
                    {p.sharpe.toFixed(2)}
                  </span>
                }
              />
            )}
          </Section>
        )}

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
