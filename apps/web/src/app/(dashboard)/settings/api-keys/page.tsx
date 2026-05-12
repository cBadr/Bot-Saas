'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  useExchangeKeys, useCreateExchangeKey, useTestExchangeKey, useDeleteExchangeKey,
} from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { KeyRound, Plus, Trash2, Zap, Eye, EyeOff } from 'lucide-react';

export default function ApiKeysSettingsPage() {
  const { data: keys } = useExchangeKeys();
  const create = useCreateExchangeKey();
  const test = useTestExchangeKey();
  const del = useDeleteExchangeKey();

  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showForm, setShowForm] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate(
      { label: label.trim(), apiKey: apiKey.trim(), apiSecret: apiSecret.trim() },
      {
        onSuccess: () => {
          toast.success('API key added');
          setLabel(''); setApiKey(''); setApiSecret(''); setShowForm(false);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">API Keys</h2>
        <p className="text-sm text-muted-foreground">
          Exchange API keys are encrypted at rest with AES-256-GCM. Keep withdrawals disabled on the exchange side.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> Your keys
                <Badge variant="outline" className="text-[10px]">{keys?.length ?? 0}</Badge>
              </CardTitle>
              <CardDescription className="text-xs">Each key can be tied to multiple bots.</CardDescription>
            </div>
            {!showForm && (
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add key
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {showForm && (
            <form onSubmit={submit} className="space-y-3 rounded-md border bg-muted/20 p-3 mb-4">
              <div>
                <Label htmlFor="label" className="text-xs">Label</Label>
                <Input id="label" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Binance main" />
              </div>
              <div>
                <Label htmlFor="apiKey" className="text-xs">API Key</Label>
                <Input id="apiKey" required value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="font-mono" />
              </div>
              <div>
                <Label htmlFor="apiSecret" className="text-xs">API Secret</Label>
                <div className="relative">
                  <Input id="apiSecret" type={showSecret ? 'text' : 'password'} required
                    value={apiSecret} onChange={(e) => setApiSecret(e.target.value)}
                    className="font-mono pr-10" />
                  <button type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={create.isPending}>
                  {create.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Tip: On Binance, enable <strong>Spot Trading</strong> only. Withdrawals must stay disabled.
              </p>
            </form>
          )}

          {!keys?.length && !showForm ? (
            <p className="text-xs text-muted-foreground italic">No API keys yet. Add one to start trading.</p>
          ) : (
            <div className="space-y-2">
              {keys?.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-2 border rounded-md p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{k.label}</span>
                      <Badge variant="outline" className="text-[9px] font-mono">{k.exchange}</Badge>
                      <Badge
                        variant={k.status === 'ACTIVE' ? 'success' : 'destructive'}
                        className="text-[9px]">{k.status}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                      {k.apiKey} · created {new Date(k.createdAt).toLocaleDateString()}
                    </div>
                    {k.lastError && (
                      <div className="text-[11px] text-destructive font-mono mt-0.5 truncate">
                        Last error: {k.lastError}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button
                      size="sm" variant="ghost"
                      disabled={test.isPending}
                      onClick={() => test.mutate(k.id, {
                        onSuccess: (r) => toast.success(`Test OK (canTrade: ${r.canTrade ? 'yes' : 'no'})`),
                        onError: (e) => toast.error(e.message),
                      })}>
                      <Zap className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      disabled={del.isPending}
                      onClick={() => {
                        if (!confirm(`Delete API key "${k.label}"? Bots using it will stop.`)) return;
                        del.mutate(k.id, {
                          onSuccess: () => toast.success('Key deleted'),
                          onError: (e) => toast.error(e.message),
                        });
                      }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>• Rotating an API key currently requires deleting + re-adding (full rotation flow is on the roadmap).</p>
        <p>• Last-used timestamp and IP per key — coming soon (requires API call logging).</p>
      </div>
    </div>
  );
}
