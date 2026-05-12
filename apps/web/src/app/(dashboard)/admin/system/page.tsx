'use client';
import { toast } from 'sonner';
import {
  useAdminSystemHealth, useSetMaintenanceMode, useAdminErrors, useBinanceHealth,
} from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatNumber, formatRelativeTime } from '@/lib/utils';
import {
  Activity, Database, Wifi, WifiOff, AlertTriangle, Power, Server,
  Globe, Bug,
} from 'lucide-react';

export default function AdminSystemPage() {
  const { data: health } = useAdminSystemHealth();
  const { data: errors } = useAdminErrors({ limit: 50 });
  const { data: binance } = useBinanceHealth();
  const setMaintenance = useSetMaintenanceMode();

  if (!health) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Live status of the platform's core infrastructure.</p>

      {/* Service tiles */}
      <div className="grid gap-4 md:grid-cols-4">
        <ServiceTile
          label="Database"
          icon={<Database className="h-5 w-5" />}
          ok={health.db.ok}
          metrics={[
            { label: 'Latency', value: health.db.latencyMs !== null ? `${health.db.latencyMs}ms` : '—' },
            { label: 'Users', value: String(health.db.users) },
            { label: 'Bots', value: String(health.db.bots) },
          ]}
        />
        <ServiceTile
          label="Redis"
          icon={<Server className="h-5 w-5" />}
          ok={health.redis.ok}
          metrics={[{ label: 'Ping', value: health.redis.ok ? 'PONG' : 'no response' }]}
        />
        <ServiceTile
          label="Engine"
          icon={<Activity className="h-5 w-5" />}
          ok={health.engine.ok}
          metrics={[{
            label: 'Last event',
            value: health.engine.lastEventAgoMs !== null
              ? `${Math.round(health.engine.lastEventAgoMs / 1000)}s ago`
              : 'never',
          }]}
          warning={!health.engine.ok ? 'No engine activity in 2+ minutes.' : undefined}
        />
        <ServiceTile
          label="Binance API"
          icon={<Globe className="h-5 w-5" />}
          ok={(binance?.errorRate1h ?? 0) < 5}
          metrics={[
            { label: 'Calls 1h', value: formatNumber(binance?.calls1h ?? 0) },
            { label: 'Avg latency', value: `${binance?.avgLatencyMs ?? 0}ms` },
            { label: 'Error rate', value: `${(binance?.errorRate1h ?? 0).toFixed(1)}%` },
          ]}
        />
      </div>

      {/* Maintenance mode */}
      <Card className={health.maintenanceMode ? 'border-destructive/40 bg-destructive/5' : ''}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Power className="h-4 w-4" />
            Maintenance mode
            {health.maintenanceMode && (
              <Badge variant="destructive" className="text-[10px]">ACTIVE</Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            When enabled, the platform stops accepting new bot starts and serves a banner to all users.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {health.maintenanceMode ? (
            <Button variant="success" disabled={setMaintenance.isPending}
              onClick={() => setMaintenance.mutate(false, {
                onSuccess: () => toast.success('Maintenance mode disabled'),
                onError: (e) => toast.error(e.message),
              })}>
              <Power className="h-3.5 w-3.5 mr-1" /> Exit maintenance
            </Button>
          ) : (
            <Button variant="destructive" disabled={setMaintenance.isPending}
              onClick={() => {
                if (!confirm('Enable maintenance mode? Users will see a banner and bot starts will be blocked.')) return;
                setMaintenance.mutate(true, {
                  onSuccess: () => toast.success('Maintenance mode enabled'),
                  onError: (e) => toast.error(e.message),
                });
              }}>
              <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Enable maintenance
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Errors feed */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Bug className="h-4 w-4 text-destructive" /> Bot errors (24h)
              <Badge variant="outline" className="text-[10px]">{errors?.botErrors.length ?? 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-[420px] overflow-y-auto">
            {!errors?.botErrors.length ? (
              <p className="p-3 text-xs italic text-muted-foreground">No bot errors in the last 24 hours. ✓</p>
            ) : (
              errors.botErrors.map((e) => (
                <div key={e.id} className="px-3 py-1.5 border-b last:border-0 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="destructive" className="text-[9px] font-mono">{e.type}</Badge>
                    <span className="font-mono text-[10px]">{e.bot.symbol}</span>
                    <span className="text-[10px] text-muted-foreground truncate flex-1">{e.bot.name}</span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatRelativeTime(e.createdAt)}</span>
                  </div>
                  <p className="text-[11px] mt-0.5 break-words">{e.message}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{e.bot.user.email}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Bug className="h-4 w-4 text-amber-500" /> System errors (24h)
              <Badge variant="outline" className="text-[10px]">{errors?.systemErrors.length ?? 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-[420px] overflow-y-auto">
            {!errors?.systemErrors.length ? (
              <p className="p-3 text-xs italic text-muted-foreground">No system errors in the last 24 hours. ✓</p>
            ) : (
              errors.systemErrors.map((e) => (
                <div key={e.id} className="px-3 py-1.5 border-b last:border-0 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="destructive" className="text-[9px] font-mono">{e.level}</Badge>
                    <Badge variant="outline" className="text-[9px]">{e.category}</Badge>
                    {e.service && <span className="text-[10px] font-mono text-muted-foreground">{e.service}</span>}
                    <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">{formatRelativeTime(e.createdAt)}</span>
                  </div>
                  <p className="text-[11px] mt-0.5 break-words">{e.message}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Binance details */}
      {binance && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4" /> Binance API · Last hour
            </CardTitle>
            <CardDescription className="text-xs">
              {formatNumber(binance.calls1h)} calls · {binance.avgLatencyMs}ms avg · max weight {binance.maxWeight1h}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Slowest calls</div>
              {binance.slowest.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">No data.</p>
              ) : binance.slowest.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                  <span className="font-mono truncate">{s.method} {s.endpoint}</span>
                  <span className="font-mono tabular-nums">{s.durationMs}ms · {s.statusCode}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Recent errors</div>
              {binance.recentErrors.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">No errors. ✓</p>
              ) : binance.recentErrors.map((e, i) => (
                <div key={i} className="text-xs py-1 border-b last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono truncate">{e.endpoint}</span>
                    <Badge variant="destructive" className="text-[9px] font-mono">{e.errorCode ?? '—'}</Badge>
                  </div>
                  {e.errorMessage && <p className="text-[10px] text-muted-foreground truncate">{e.errorMessage}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground italic">
        Last health check: {new Date(health.ts).toLocaleTimeString()} · auto-refresh every 10s
      </p>
    </div>
  );
}

function ServiceTile({ label, icon, ok, metrics, warning }: {
  label: string;
  icon: React.ReactNode;
  ok: boolean;
  metrics: Array<{ label: string; value: string }>;
  warning?: string;
}) {
  return (
    <Card className={ok ? 'border-success/40' : 'border-destructive/40'}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon} {label}
          {ok
            ? <Badge variant="success" className="text-[10px] ml-auto"><Wifi className="h-3 w-3 mr-1" />ok</Badge>
            : <Badge variant="destructive" className="text-[10px] ml-auto"><WifiOff className="h-3 w-3 mr-1" />down</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {metrics.map((m, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{m.label}</span>
            <span className="font-mono tabular-nums">{m.value}</span>
          </div>
        ))}
        {warning && (
          <p className="text-[10px] text-destructive italic mt-2">{warning}</p>
        )}
      </CardContent>
    </Card>
  );
}
