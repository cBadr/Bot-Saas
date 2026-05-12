'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAnnouncement, useSetAnnouncement, type AnnouncementCfg } from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, AlertTriangle, Info, Save } from 'lucide-react';

const EMPTY: AnnouncementCfg = {
  enabled: false, message: '', severity: 'info',
};

export default function AdminAnnouncementPage() {
  const { data: current } = useAnnouncement();
  const save = useSetAnnouncement();
  const [form, setForm] = useState<AnnouncementCfg>(EMPTY);

  useEffect(() => {
    if (current) setForm(current);
  }, [current]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.enabled && !form.message.trim()) {
      toast.error('Message is required when announcement is enabled');
      return;
    }
    save.mutate(form, {
      onSuccess: () => toast.success(form.enabled ? 'Announcement live' : 'Announcement disabled'),
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Shows a banner at the top of every authenticated page. Use sparingly — high-signal events only.
      </p>

      {/* Live preview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Preview</CardTitle>
          <CardDescription className="text-xs">
            How users will see the banner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Preview cfg={form} />
        </CardContent>
      </Card>

      <form onSubmit={submit} className="space-y-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs">Status</Label>
              <label className="flex items-center gap-2 text-sm mt-1">
                <input type="checkbox" checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                Enabled (visible to all users)
              </label>
            </div>

            <div>
              <Label htmlFor="msg" className="text-xs">Message</Label>
              <Input id="msg" value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="e.g., Scheduled maintenance on Sunday 02:00–03:00 UTC."
                maxLength={500} />
              <p className="text-[10px] text-muted-foreground mt-0.5">{form.message.length} / 500</p>
            </div>

            <div>
              <Label className="text-xs">Severity</Label>
              <div className="flex gap-2 mt-1">
                {(['info', 'warning', 'critical'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm({ ...form, severity: s })}
                    className={`px-3 py-1 text-xs rounded border transition-colors ${
                      form.severity === s
                        ? s === 'critical' ? 'border-destructive bg-destructive/10 text-destructive'
                          : s === 'warning' ? 'border-amber-500 bg-amber-500/10 text-amber-600'
                          : 'border-primary bg-primary/10 text-primary'
                        : 'border-border'
                    }`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs">Starts at (optional)</Label>
                <Input type="datetime-local" value={form.startsAt ?? ''}
                  onChange={(e) => setForm({ ...form, startsAt: e.target.value || undefined })} />
              </div>
              <div>
                <Label className="text-xs">Ends at (optional)</Label>
                <Input type="datetime-local" value={form.endsAt ?? ''}
                  onChange={(e) => setForm({ ...form, endsAt: e.target.value || undefined })} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={save.isPending}>
          <Save className="h-3.5 w-3.5 mr-1" />
          {save.isPending ? 'Saving…' : 'Save announcement'}
        </Button>
      </form>
    </div>
  );
}

function Preview({ cfg }: { cfg: AnnouncementCfg }) {
  if (!cfg.message.trim()) {
    return <p className="text-xs italic text-muted-foreground">Enter a message to preview.</p>;
  }
  if (!cfg.enabled) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline">Disabled</Badge>
        <span className="text-muted-foreground">Banner won't appear until you enable it.</span>
      </div>
    );
  }
  const Icon = cfg.severity === 'critical' ? AlertCircle : cfg.severity === 'warning' ? AlertTriangle : Info;
  const cls = cfg.severity === 'critical' ? 'bg-destructive/10 text-destructive border-destructive/30'
    : cfg.severity === 'warning' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
    : 'bg-primary/10 text-primary border-primary/30';
  return (
    <div className={`${cls} border rounded-md px-4 py-2 text-sm flex items-center gap-2`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span>{cfg.message}</span>
    </div>
  );
}
