'use client';
import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { useReportsOverview, usePnlSeries } from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/utils';

export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const { data: overview } = useReportsOverview();
  const { data: series } = usePnlSeries(days);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">Performance analytics across all your bots.</p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <Button key={d} variant={d === days ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)}>{d}d</Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Realized P&L" value={formatNumber(overview?.totals.realizedPnl ?? 0)} />
        <Stat label="Unrealized P&L" value={formatNumber(overview?.totals.unrealizedPnl ?? 0)} />
        <Stat label="Total Volume" value={formatNumber(overview?.totals.volume ?? 0)} />
        <Stat label="Total Trades" value={String(overview?.totals.trades ?? 0)} />
      </div>

      <Card>
        <CardHeader><CardTitle>Daily P&amp;L · last {days} days</CardTitle></CardHeader>
        <CardContent>
          {!series?.length ? (
            <p className="text-sm text-muted-foreground py-12 text-center">No trades in this window.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                <Line type="monotone" dataKey="pnl" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Daily Volume</CardTitle></CardHeader>
        <CardContent>
          {series?.length ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                <Bar dataKey="volume" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="p-6">
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </CardContent></Card>
  );
}
