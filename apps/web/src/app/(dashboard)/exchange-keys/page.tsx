'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Plus, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { useCreateExchangeKey, useDeleteExchangeKey, useExchangeKeys, useTestExchangeKey } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/utils';

interface FormData { label: string; apiKey: string; apiSecret: string }

export default function ExchangeKeysPage() {
  const { data: keys } = useExchangeKeys();
  const create = useCreateExchangeKey();
  const test = useTestExchangeKey();
  const del = useDeleteExchangeKey();
  const [showForm, setShowForm] = useState(false);
  const { register, handleSubmit, reset } = useForm<FormData>();

  const onAdd = (data: FormData) => {
    create.mutate(data, {
      onSuccess: () => {
        toast.success('API key added');
        reset();
        setShowForm(false);
      },
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Binance API Keys</h1>
          <p className="text-muted-foreground">Connect and verify your Binance accounts.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4" />Add Key</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>New API key</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onAdd)} className="space-y-4">
              <div className="space-y-2"><Label>Label</Label>
                <Input placeholder="My Binance Spot" {...register('label', { required: true })} /></div>
              <div className="space-y-2"><Label>API Key</Label>
                <Input placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" {...register('apiKey', { required: true })} /></div>
              <div className="space-y-2"><Label>API Secret</Label>
                <Input type="password" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" {...register('apiSecret', { required: true })} /></div>
              <p className="text-xs text-muted-foreground">⚠️ Use a key with Spot trading + read permissions only. Never enable withdrawals.</p>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Add
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {!keys?.length ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">No API keys yet.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {keys.map((k) => (
            <Card key={k.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-medium">{k.label}</span>
                    <Badge variant={k.status === 'ACTIVE' ? 'success' : k.status === 'INVALID' ? 'destructive' : 'secondary'}>
                      {k.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{k.apiKey} · {k.exchange}</div>
                  {k.lastError && <div className="text-xs text-destructive mt-1">{k.lastError}</div>}
                  {k.lastCheckedAt && (
                    <div className="text-xs text-muted-foreground mt-1">Tested {formatRelativeTime(k.lastCheckedAt)}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={test.isPending}
                    onClick={() => test.mutate(k.id, {
                      onSuccess: (r) => r.ok ? toast.success(`Verified · ${r.balances?.length ?? 0} non-zero balances`) : toast.error('Verification failed'),
                      onError: (e) => toast.error(e.message),
                    })}>
                    <RefreshCw className="h-4 w-4" />Test
                  </Button>
                  <Button variant="ghost" size="icon" disabled={del.isPending}
                    onClick={() => {
                      if (!confirm(`Delete "${k.label}"?`)) return;
                      del.mutate(k.id, {
                        onSuccess: () => toast.success('Deleted'),
                        onError: (e) => toast.error(e.message),
                      });
                    }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
