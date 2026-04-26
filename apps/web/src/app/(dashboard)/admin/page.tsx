'use client';
import { useAdminStats } from '@/lib/queries-v2';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';

export default function AdminOverviewPage() {
  const { data: stats } = useAdminStats();
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Stat label="Total Users" value={String(stats?.users ?? 0)} />
      <Stat label="Total Bots" value={String(stats?.bots.total ?? 0)} sub={`${stats?.bots.running ?? 0} running`} />
      <Stat label="Payments" value={String(stats?.payments.total ?? 0)} sub={`${stats?.payments.completed ?? 0} completed`} />
      <Stat label="MRR (estimated)" value={formatCurrency(stats?.mrr ?? 0)} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-6">
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </CardContent></Card>
  );
}
