'use client';
import { useSearchParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  useCurrentSubscription, useMyPayments, usePlans, useCheckout, useCancelSubscription,
} from '@/lib/queries-v2';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatRelativeTime } from '@/lib/utils';

export default function BillingPage() {
  const router = useRouter();
  const search = useSearchParams();
  const preselected = search.get('plan');
  const [crypto, setCrypto] = useState('USDT.TRC20');
  const { data: plans } = usePlans();
  const { data: sub } = useCurrentSubscription();
  const { data: payments } = useMyPayments();
  const checkout = useCheckout();
  const cancel = useCancelSubscription();

  const onSubscribe = (planId: string) => {
    checkout.mutate({ planId, cryptoCurrency: crypto }, {
      onSuccess: (r) => {
        if (r.kind === 'free') {
          toast.success('Free plan activated!');
          router.refresh();
        } else if (r.checkoutUrl) {
          window.open(r.checkoutUrl, '_blank');
          toast.success('Redirecting to CoinPayments…');
        }
      },
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold">Billing</h1>
        <p className="text-muted-foreground">Manage your subscription and payment history.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Subscription</CardTitle>
          <CardDescription>Your active plan and renewal date.</CardDescription>
        </CardHeader>
        <CardContent>
          {sub ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-xl font-semibold">{sub.plan.name}</h3>
                  <Badge variant={sub.status === 'ACTIVE' ? 'success' : 'secondary'}>{sub.status}</Badge>
                  {!sub.autoRenew && <Badge variant="warning">Auto-renew off</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  ${Number(sub.plan.priceUsd).toFixed(2)} / {sub.plan.billingCycleDays}d ·
                  Renews {formatRelativeTime(sub.endsAt)}
                </p>
              </div>
              {sub.autoRenew && sub.status === 'ACTIVE' && (
                <Button variant="outline" disabled={cancel.isPending}
                  onClick={() => {
                    if (!confirm('Cancel auto-renewal?')) return;
                    cancel.mutate(sub.id, { onSuccess: () => toast.success('Cancelled') });
                  }}>
                  Cancel auto-renew
                </Button>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">No active subscription. Choose a plan below.</p>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-xl font-semibold mb-2">Plans</h2>
        <div className="mb-3">
          <label className="text-sm text-muted-foreground mr-2">Pay with:</label>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={crypto} onChange={(e) => setCrypto(e.target.value)}>
            <option value="USDT.TRC20">USDT (TRC20)</option>
            <option value="USDT.ERC20">USDT (ERC20)</option>
            <option value="USDC">USDC</option>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
          </select>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {plans?.map((p) => (
            <Card key={p.id} className={preselected === p.id ? 'border-primary' : ''}>
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <CardDescription>{p.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold mb-1">{formatCurrency(Number(p.priceUsd))}</div>
                <p className="text-xs text-muted-foreground mb-4">per {p.billingCycleDays} days</p>
                <ul className="text-xs space-y-1 mb-4">
                  <li>· {p.maxBots} bots</li>
                  <li>· {p.maxApiKeys} API keys</li>
                  <li>· {p.maxCustomStrategies} custom strategies</li>
                </ul>
                <Button size="sm" className="w-full" disabled={checkout.isPending} onClick={() => onSubscribe(p.id)}>
                  {checkout.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {Number(p.priceUsd) === 0 ? 'Activate' : 'Subscribe'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
        <CardContent>
          {!payments?.length ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <div className="divide-y">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <div className="font-medium">${Number(p.amountUsd).toFixed(2)} {p.cryptoCurrency && <span className="text-muted-foreground">in {p.cryptoCurrency}</span>}</div>
                    <div className="text-xs text-muted-foreground">{formatRelativeTime(p.createdAt)}</div>
                  </div>
                  <Badge variant={p.status === 'COMPLETED' ? 'success' : p.status === 'FAILED' ? 'destructive' : 'secondary'}>{p.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
