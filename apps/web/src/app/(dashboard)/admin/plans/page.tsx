'use client';
import { useAdminPlans } from '@/lib/queries-v2';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function AdminPlansPage() {
  const { data: plans } = useAdminPlans();
  return (
    <Card>
      <CardContent className="p-0 divide-y">
        {plans?.map((p) => (
          <div key={p.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium flex items-center gap-2">
                {p.name}
                <Badge variant={p.isActive ? 'success' : 'secondary'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                ${Number(p.priceUsd).toFixed(2)} / {p.billingCycleDays}d ·
                {p.maxBots} bots · {p.maxApiKeys} keys · {p.maxCustomStrategies} custom strats
              </div>
            </div>
            <code className="text-xs text-muted-foreground">{p.code}</code>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
