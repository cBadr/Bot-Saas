'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAdminFlags, useToggleFlag } from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

export default function AdminFlagsPage() {
  const { data: flags } = useAdminFlags();
  const toggle = useToggleFlag();
  const [newKey, setNewKey] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const create = () => {
    if (!newKey) return;
    toggle.mutate({ key: newKey, enabled: false, description: newDesc }, {
      onSuccess: () => { toast.success('Flag created'); setNewKey(''); setNewDesc(''); },
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">New flag</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3 items-end">
          <div className="space-y-1"><Label className="text-xs">Key</Label>
            <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="enable_copy_trading" /></div>
          <div className="space-y-1"><Label className="text-xs">Description</Label>
            <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} /></div>
          <Button onClick={create}>Create</Button>
        </CardContent>
      </Card>
      <Card><CardContent className="p-0 divide-y">
        {flags?.map((f) => (
          <div key={f.key} className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <code className="text-sm">{f.key}</code>
                <Badge variant={f.enabled ? 'success' : 'secondary'}>{f.enabled ? 'On' : 'Off'}</Badge>
                {f.rolloutPct > 0 && <Badge variant="outline">{f.rolloutPct}% rollout</Badge>}
              </div>
              {f.description && <p className="text-xs text-muted-foreground mt-1">{f.description}</p>}
            </div>
            <Button variant="outline" size="sm"
              onClick={() => toggle.mutate({ key: f.key, enabled: !f.enabled }, {
                onSuccess: () => toast.success(`${f.key} ${!f.enabled ? 'enabled' : 'disabled'}`),
              })}>
              {f.enabled ? 'Disable' : 'Enable'}
            </Button>
          </div>
        ))}
        {!flags?.length && <div className="p-12 text-center text-muted-foreground">No feature flags yet.</div>}
      </CardContent></Card>
    </div>
  );
}
