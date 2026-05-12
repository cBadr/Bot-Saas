'use client';
import Link from 'next/link';
import { useMe, useBots } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, ExternalLink, Zap } from 'lucide-react';

export default function BillingPage() {
  const { data: me } = useMe();
  const { data: bots } = useBots();
  if (!me) return null;

  const trialActive = me.trialEndsAt && new Date(me.trialEndsAt) > new Date();
  const trialDaysLeft = trialActive
    ? Math.ceil((new Date(me.trialEndsAt!).getTime() - Date.now()) / 86_400_000)
    : 0;

  const totalBots = bots?.length ?? 0;
  const runningBots = bots?.filter((b) => b.status === 'RUNNING').length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Billing & Plan</h2>
        <p className="text-sm text-muted-foreground">Your subscription, payment history, and usage.</p>
      </div>

      {trialActive && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-4 flex items-center gap-3">
            <Zap className="h-5 w-5 text-amber-500" />
            <div className="flex-1">
              <div className="font-medium text-sm">Trial active</div>
              <div className="text-xs text-muted-foreground">
                Your 14-day free trial ends in <strong>{trialDaysLeft}</strong> day{trialDaysLeft === 1 ? '' : 's'}.
              </div>
            </div>
            <Link href="/billing">
              <Button size="sm">View plans</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Current plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {trialActive ? 'Trial' : 'Free'}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {trialActive ? `${trialDaysLeft}d left` : 'Limited features'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Full plan management (upgrade / downgrade / cancel / invoice history) is handled on the dedicated billing page.
          </p>
          <Link href="/billing">
            <Button variant="outline" size="sm">
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Manage subscription
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage this period</CardTitle>
          <CardDescription className="text-xs">Resource consumption against your plan limits.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Metric label="Total bots" value={totalBots} />
          <Metric label="Running now" value={runningBots} />
          <Metric label="Volume traded (30d)" value="—" hint="Coming soon" />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold font-mono tabular-nums mt-1">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5 italic">{hint}</div>}
    </div>
  );
}
