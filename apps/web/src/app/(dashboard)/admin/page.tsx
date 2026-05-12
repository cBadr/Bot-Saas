'use client';
import Link from 'next/link';
import {
  useAdminStats, useAdminAlerts, useAdminTimeseries, useAdminFunnel,
  useAdminTopLists, useAdminSystemHealth, useApprovals, useAdminAudit,
  useNpsSummary, useAdminStrategyUsage,
} from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatNumber, formatRelativeTime } from '@/lib/utils';
import {
  AlertTriangle, AlertCircle, Info, Users, Bot, CreditCard, DollarSign,
  TrendingUp, Activity, Wifi, WifiOff, ShieldCheck, MessageSquare,
  History, ChevronRight, Smile, ArrowUpRight,
} from 'lucide-react';

export default function AdminOverviewPage() {
  const { data: stats } = useAdminStats();
  const { data: alerts } = useAdminAlerts();
  const { data: series } = useAdminTimeseries(30);
  const { data: funnel } = useAdminFunnel();
  const { data: top } = useAdminTopLists();
  const { data: health } = useAdminSystemHealth();
  const { data: approvals } = useApprovals('pending');
  const { data: recentAudit } = useAdminAudit({ limit: 10 });
  const { data: nps } = useNpsSummary(90);
  const { data: strategyUsage } = useAdminStrategyUsage();

  return (
    <div className="space-y-5">
      {/* System health strip */}
      <div className="rounded-md border bg-card px-3 py-2 flex items-center gap-3 flex-wrap text-xs">
        <span className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground">Infrastructure</span>
        <HealthDot label="DB" ok={health?.db.ok} detail={health?.db.latencyMs ? `${health.db.latencyMs}ms` : ''} />
        <HealthDot label="Redis" ok={health?.redis.ok} />
        <HealthDot label="Engine" ok={health?.engine.ok}
          detail={health?.engine.lastEventAgoMs !== null && health?.engine.lastEventAgoMs !== undefined
            ? `${Math.round(health.engine.lastEventAgoMs / 1000)}s ago` : 'no events'} />
        {health?.maintenanceMode && (
          <Badge variant="destructive" className="text-[10px]">MAINTENANCE MODE</Badge>
        )}
        <span className="ml-auto text-muted-foreground text-[10px]">
          {stats?.ts ? `updated ${new Date(stats.ts).toLocaleTimeString()}` : '—'}
        </span>
      </div>

      {/* Alerts */}
      {alerts && alerts.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
            Action needed
          </div>
          {alerts.map((a) => <AlertRow key={a.id} alert={a} />)}
        </div>
      )}

      {/* Primary KPIs (4 hero tiles + revenue) */}
      <div className="grid gap-3 md:grid-cols-4">
        <KpiHero icon={<DollarSign className="h-4 w-4" />}
          label="MRR"
          value={formatCurrency(stats?.revenue.mrr ?? 0)}
          sub={stats ? `${stats.revenue.activeSubs} active subscriptions` : ''}
          href="/admin/payments"
          tone="positive" />
        <KpiHero icon={<Users className="h-4 w-4" />}
          label="Total users"
          value={formatNumber(stats?.users.total ?? 0)}
          sub={stats ? `+${stats.users.signups24h} today · +${stats.users.signups7d}/wk` : ''}
          href="/admin/users" />
        <KpiHero icon={<Bot className="h-4 w-4" />}
          label="Running bots"
          value={formatNumber(stats?.bots.running ?? 0)}
          sub={stats ? `of ${stats.bots.total}${stats.bots.stuck > 0 ? ` · ${stats.bots.stuck} stuck` : ''}` : ''}
          href="/admin/bots"
          tone={(stats?.bots.stuck ?? 0) > 0 ? 'warning' : 'positive'} />
        <KpiHero icon={<TrendingUp className="h-4 w-4" />}
          label="Volume 24h"
          value={formatNumber(stats?.trading.volume24h ?? 0, { maximumFractionDigits: 0 })}
          sub={stats ? `${formatNumber(stats.trading.trades24h)} trades` : ''}
          href="/admin/bots" />
      </div>

      {/* Secondary metrics row */}
      <div className="grid gap-3 md:grid-cols-4">
        <KpiCompact label="Trials active" value={String(stats?.growth.trialsActive ?? 0)}
          sub={`${stats?.growth.trialsConverted30d ?? 0} converted (30d)`} />
        <KpiCompact label="Churn 30d" value={`${(stats?.growth.churnRate ?? 0).toFixed(1)}%`}
          sub={`${stats?.growth.churned30d ?? 0} canceled`}
          tone={(stats?.growth.churnRate ?? 0) > 10 ? 'warning' : undefined} />
        <KpiCompact label="Pending payments" value={String(stats?.payments.pending ?? 0)}
          sub={stats?.payments.failed24h ? `${stats.payments.failed24h} failed 24h` : 'no failures'}
          tone={(stats?.payments.failed24h ?? 0) > 0 ? 'critical' : undefined} />
        <KpiCompact label="Errors 1h" value={String(stats?.health.errors1h ?? 0)}
          sub="bot events"
          tone={(stats?.health.errors1h ?? 0) > 10 ? 'warning' : undefined} />
      </div>

      {/* Revenue chart + Funnel */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              Revenue & Signups · 30d
              <Link href="/admin/payments" className="text-xs text-primary hover:underline font-normal">View payments →</Link>
            </CardTitle>
            <CardDescription className="text-xs">Daily completed revenue (bars) + new signups (line).</CardDescription>
          </CardHeader>
          <CardContent>
            {series && series.length > 0 ? <RevSignupsChart data={series} /> : (
              <p className="text-xs text-muted-foreground italic">No data yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              Acquisition Funnel · 30d
              <Link href="/admin/analytics" className="text-xs text-primary hover:underline font-normal">Deep dive →</Link>
            </CardTitle>
            <CardDescription className="text-xs">From signup to active paying user.</CardDescription>
          </CardHeader>
          <CardContent>
            {funnel ? <Funnel steps={funnel} /> : <p className="text-xs italic text-muted-foreground">Loading…</p>}
          </CardContent>
        </Card>
      </div>

      {/* Section spotlight: Approvals + NPS + Strategy Usage */}
      <div className="grid gap-5 lg:grid-cols-3">
        <SectionCard
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Pending approvals"
          href="/admin/approvals"
          tone={(approvals?.length ?? 0) > 0 ? 'warning' : undefined}
        >
          {!approvals?.length ? (
            <p className="text-xs italic text-muted-foreground">No pending approvals.</p>
          ) : (
            <div className="space-y-1.5">
              {approvals.slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-center justify-between text-xs border-b last:border-0 pb-1.5 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <Badge variant="outline" className="text-[9px] font-mono mr-1">{a.action}</Badge>
                    <span className="text-[10px] text-muted-foreground">{a.requestedByUser.email}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatRelativeTime(a.createdAt)}</span>
                </div>
              ))}
              {approvals.length > 4 && (
                <p className="text-[10px] text-muted-foreground italic">+{approvals.length - 4} more</p>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={<Smile className="h-4 w-4" />}
          title="NPS · 90d"
          href="/admin/surveys"
        >
          {!nps?.total ? (
            <p className="text-xs italic text-muted-foreground">No responses yet.</p>
          ) : (
            <div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className={`text-3xl font-bold tabular-nums ${
                  (nps.nps ?? 0) >= 50 ? 'text-success' : (nps.nps ?? 0) >= 0 ? 'text-amber-500' : 'text-destructive'
                }`}>
                  {nps.nps ?? '—'}
                </span>
                <span className="text-[10px] text-muted-foreground">{nps.total} responses</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden flex bg-muted">
                <div className="bg-destructive" style={{ width: `${(nps.detractors / nps.total) * 100}%` }} />
                <div className="bg-amber-500" style={{ width: `${(nps.passives / nps.total) * 100}%` }} />
                <div className="bg-success" style={{ width: `${(nps.promoters / nps.total) * 100}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-mono">
                <span>{nps.detractors} detractors</span>
                <span>{nps.passives} passives</span>
                <span>{nps.promoters} promoters</span>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={<Bot className="h-4 w-4" />}
          title="Strategy mix"
          href="/admin/bots"
        >
          {!strategyUsage?.length ? (
            <p className="text-xs italic text-muted-foreground">No bots yet.</p>
          ) : (
            <div className="space-y-1.5">
              {strategyUsage.slice(0, 5).map((s) => {
                const total = strategyUsage.reduce((sum, x) => sum + x.count, 0);
                const pct = total > 0 ? (s.count / total) * 100 : 0;
                return (
                  <div key={s.strategyId}>
                    <div className="flex justify-between text-xs">
                      <span className="truncate">{s.builtinKey ?? s.name}</span>
                      <span className="font-mono tabular-nums">{s.count} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-1 rounded-full bg-muted mt-0.5">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Top lists row */}
      <div className="grid gap-5 lg:grid-cols-3">
        <TopList title="Top by 24h volume" href="/admin/bots" rows={top?.topVolume?.map((r) => ({
          primary: r.name,
          secondary: `${r.symbol} · ${r.owner}`,
          value: formatNumber(r.volume, { maximumFractionDigits: 0 }),
        })) ?? []} />
        <TopList title="Top performing bots" href="/admin/bots" rows={top?.topBots?.map((b) => ({
          primary: b.name,
          secondary: `${b.symbol} · ${b.owner}`,
          value: `+${formatNumber(b.pnl, { maximumFractionDigits: 2 })}`,
          tone: 'positive' as const,
        })) ?? []} />
        <TopList title="Top symbols" href="/admin/analytics" rows={top?.topSymbols?.map((s) => ({
          primary: s.symbol,
          secondary: `${s.count} bot${s.count === 1 ? '' : 's'}`,
          value: String(s.count),
        })) ?? []} />
      </div>

      {/* Recent admin activity (audit log) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2"><History className="h-4 w-4" /> Recent admin activity</span>
            <Link href="/admin/audit" className="text-xs text-primary hover:underline font-normal">Full log →</Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!recentAudit?.length ? (
            <p className="px-3 py-3 text-xs italic text-muted-foreground">No activity yet.</p>
          ) : (
            recentAudit.slice(0, 10).map((e) => (
              <div key={e.id} className="px-3 py-1.5 border-b last:border-0 flex items-center gap-2 text-xs">
                <Badge variant={e.actorType === 'ADMIN' ? 'warning' : 'outline'} className="text-[9px] font-mono">
                  {e.actorType}
                </Badge>
                <code className="text-xs">{e.action}</code>
                {e.targetType && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {e.targetType}:{e.targetId?.slice(0, 8)}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatRelativeTime(e.createdAt)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HealthDot({ label, ok, detail }: { label: string; ok?: boolean; detail?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {ok ? <Wifi className="h-3 w-3 text-success" /> : <WifiOff className="h-3 w-3 text-destructive" />}
      <span className="font-medium">{label}</span>
      <span className={ok ? 'text-success' : 'text-destructive'}>{ok ? 'ok' : 'down'}</span>
      {detail && <span className="text-muted-foreground">· {detail}</span>}
    </span>
  );
}

function AlertRow({ alert: a }: { alert: { id: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; href?: string } }) {
  const tone = a.severity === 'critical' ? 'border-destructive/40 bg-destructive/5'
    : a.severity === 'warning' ? 'border-amber-500/40 bg-amber-500/5'
    : 'border-primary/40 bg-primary/5';
  const Icon = a.severity === 'critical' ? AlertCircle : a.severity === 'warning' ? AlertTriangle : Info;
  const inner = (
    <div className={`rounded-md border ${tone} p-3 flex items-start gap-2.5 text-sm`}>
      <Icon className={`h-4 w-4 mt-0.5 ${a.severity === 'critical' ? 'text-destructive' : a.severity === 'warning' ? 'text-amber-500' : 'text-primary'}`} />
      <div className="flex-1 min-w-0">
        <div className="font-medium">{a.title}</div>
        <div className="text-xs text-muted-foreground">{a.detail}</div>
      </div>
      {a.href && <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5" />}
    </div>
  );
  return a.href ? <Link href={a.href}>{inner}</Link> : inner;
}

function KpiHero({ icon, label, value, sub, tone, href }: {
  icon?: React.ReactNode; label: string; value: string; sub?: string;
  tone?: 'positive' | 'warning' | 'critical'; href?: string;
}) {
  const toneRing = tone === 'critical' ? 'border-destructive/40'
    : tone === 'warning' ? 'border-amber-500/40'
    : tone === 'positive' ? 'border-success/40' : '';
  const inner = (
    <Card className={`${toneRing} hover:shadow-md transition-shadow ${href ? 'cursor-pointer' : ''}`}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          <span className="flex items-center gap-1.5">{icon}{label}</span>
          {href && <ArrowUpRight className="h-3 w-3" />}
        </div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground truncate mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function KpiCompact({ label, value, sub, tone }: {
  label: string; value: string; sub?: string;
  tone?: 'warning' | 'critical';
}) {
  const toneRing = tone === 'critical' ? 'border-destructive/40 bg-destructive/5'
    : tone === 'warning' ? 'border-amber-500/40 bg-amber-500/5' : '';
  return (
    <div className={`rounded-md border ${toneRing} p-3`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function SectionCard({ icon, title, href, tone, children }: {
  icon: React.ReactNode; title: string; href: string;
  tone?: 'warning' | 'critical';
  children: React.ReactNode;
}) {
  const ring = tone === 'critical' ? 'border-destructive/40'
    : tone === 'warning' ? 'border-amber-500/40' : '';
  return (
    <Card className={ring}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">{icon}{title}</span>
          <Link href={href} className="text-[10px] text-primary hover:underline font-normal flex items-center gap-0.5">
            View <ChevronRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function RevSignupsChart({ data }: { data: Array<{ date: string; signups: number; revenue: number }> }) {
  const maxRev = Math.max(1, ...data.map((d) => d.revenue));
  const maxSign = Math.max(1, ...data.map((d) => d.signups));
  const w = 600, h = 140, pad = 8;
  const bw = (w - 2 * pad) / data.length;
  const yRev = (v: number) => h - pad - (v / maxRev) * (h - 2 * pad);
  const ySign = (v: number) => h - pad - (v / maxSign) * (h - 2 * pad);
  const signupsPath = data.map((d, i) => {
    const x = pad + i * bw + bw / 2;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ySign(d.signups).toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {data.map((d, i) => (
        <rect key={i}
          x={pad + i * bw + 1}
          y={yRev(d.revenue)}
          width={Math.max(1, bw - 2)}
          height={h - pad - yRev(d.revenue)}
          fill="#22c55e" opacity="0.5" />
      ))}
      <path d={signupsPath} fill="none" stroke="#3b82f6" strokeWidth="2" />
      <text x={pad} y={pad + 8} className="text-[9px] fill-current" opacity="0.6">
        max rev ${formatNumber(maxRev, { maximumFractionDigits: 0 })} · max signups {maxSign}
      </text>
    </svg>
  );
}

function Funnel({ steps }: { steps: Array<{ step: string; count: number }> }) {
  const top = Math.max(1, steps[0]?.count ?? 1);
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const pct = (s.count / top) * 100;
        const dropoff = i > 0 ? ((steps[i - 1].count - s.count) / Math.max(1, steps[i - 1].count)) * 100 : 0;
        return (
          <div key={s.step}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium">{s.step}</span>
              <span className="font-mono tabular-nums">
                {formatNumber(s.count)}
                {i > 0 && <span className="text-muted-foreground ml-1.5">−{dropoff.toFixed(0)}%</span>}
              </span>
            </div>
            <div className="h-5 rounded-md bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopList({ title, href, rows }: {
  title: string;
  href?: string;
  rows: Array<{ primary: string; secondary: string; value: string; tone?: 'positive' | 'negative' }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>{title}</span>
          {href && <Link href={href} className="text-[10px] text-primary hover:underline font-normal">View →</Link>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 max-h-[260px] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground italic p-3">No data.</p>
        ) : (
          <div>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b last:border-0 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.primary}</div>
                  <div className="truncate text-[10px] text-muted-foreground font-mono">{r.secondary}</div>
                </div>
                <span className={`font-mono tabular-nums whitespace-nowrap ${
                  r.tone === 'positive' ? 'text-success' : r.tone === 'negative' ? 'text-destructive' : ''
                }`}>
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
