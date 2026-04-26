'use client';
import { useBots, useExchangeKeys } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { Activity, Bot, DollarSign, Key } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const { data: bots } = useBots();
  const { data: keys } = useExchangeKeys();

  const running = bots?.filter((b) => b.status === 'RUNNING').length ?? 0;
  const totalPnl = bots?.reduce((s, b) => s + Number(b.realizedPnlQuote ?? 0), 0) ?? 0;
  const totalTrades = bots?.reduce((s, b) => s + (b.totalTrades ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6 max-w-7xl">
      <OnboardingWizard />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your trading bots and account.</p>
        </div>
        <Button asChild><Link href="/bots/new">Create bot</Link></Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={Bot} label="Total Bots" value={String(bots?.length ?? 0)} sub={`${running} running`} />
        <StatCard icon={Activity} label="Total Trades" value={formatNumber(totalTrades, { maximumFractionDigits: 0 })} />
        <StatCard icon={DollarSign} label="Realized P&L" value={formatNumber(totalPnl)} sub="quote currency" />
        <StatCard icon={Key} label="API Keys" value={String(keys?.length ?? 0)} />
      </div>

      <Card>
        <CardHeader><CardTitle>Active Bots</CardTitle></CardHeader>
        <CardContent>
          {!bots?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="mb-4">No bots yet. Get started by creating your first one.</p>
              <Button asChild><Link href="/bots/new">Create your first bot</Link></Button>
            </div>
          ) : (
            <div className="divide-y">
              {bots.slice(0, 5).map((b) => (
                <Link key={b.id} href={`/bots/${b.id}`} className="flex items-center justify-between py-3 hover:bg-accent/30 -mx-2 px-2 rounded">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {b.name}
                      <span className="text-xs text-muted-foreground font-mono">{b.symbol}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{b.strategy?.name} · {b.totalTrades} trades</div>
                  </div>
                  <StatusBadge status={b.status} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: typeof Bot; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

