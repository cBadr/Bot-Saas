'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { pingApi, type ApiHealth } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ConnectionStatus() {
  const [open, setOpen] = useState(false);
  const { data, isFetching, refetch } = useQuery<ApiHealth>({
    queryKey: ['api-health'],
    queryFn: pingApi,
    refetchInterval: 15_000,
    retry: false,
  });

  const allOk = data?.ok && data?.checks?.db?.ok && data?.checks?.redis?.ok && data?.checks?.binance?.ok;
  const partial = data?.ok && !allOk;
  const offline = !data || data.ok === false;

  const color = offline ? 'bg-destructive' : partial ? 'bg-warning' : 'bg-success';
  const label = offline ? 'API offline' : partial ? 'Degraded' : 'All systems OK';

  const onTest = async () => {
    const r = await refetch();
    if (r.data?.ok && r.data.checks?.db?.ok && r.data.checks?.redis?.ok && r.data.checks?.binance?.ok) {
      toast.success('All services healthy');
    } else if (r.data?.ok) {
      toast.warning('Some services degraded');
    } else {
      toast.error(r.data?.error ?? 'API offline — start it with `pnpm start:all`');
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm hover:bg-accent transition-colors"
        title={label}
      >
        <span className={cn('h-2 w-2 rounded-full', color, !offline && 'animate-pulse')} />
        <span className="text-muted-foreground hidden md:inline">{label}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border bg-card shadow-lg z-20 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Service status</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onTest} disabled={isFetching}>
                <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
              </Button>
            </div>
            {offline ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">API server is unreachable</span>
                </div>
                <p className="text-xs text-muted-foreground">{data?.error ?? 'Cannot connect to localhost:4000'}</p>
                <div className="rounded-md bg-muted p-2 text-xs font-mono">
                  <p className="text-muted-foreground mb-1"># Start it from the project root:</p>
                  <p>pnpm start:all</p>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Row name="API server" ok={true} />
                <Row name="Database (PostgreSQL)" ok={!!data?.checks?.db?.ok} />
                <Row name="Cache (Redis)" ok={!!data?.checks?.redis?.ok} />
                <Row name="Binance time sync" ok={!!data?.checks?.binance?.ok} />
              </div>
            )}
            <Button size="sm" className="w-full mt-3" variant="outline" onClick={onTest} disabled={isFetching}>
              <Activity className="h-3.5 w-3.5" />
              Test connection
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ name, ok }: { name: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-muted-foreground">{name}</span>
      {ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
    </div>
  );
}
