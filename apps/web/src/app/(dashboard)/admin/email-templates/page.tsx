'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  useEmailTemplates, useUpsertEmailTemplate, useDeleteEmailTemplate,
  type EmailTemplateRow,
} from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Mail, Pencil, Plus, Trash2, X } from 'lucide-react';

type Form = {
  key: string; name: string; subject: string; body: string;
  variables: string;  // CSV
  description: string;
  isActive: boolean;
};
const EMPTY: Form = {
  key: '', name: '', subject: '', body: '',
  variables: '', description: '', isActive: true,
};

export default function AdminEmailTemplatesPage() {
  const { data: templates } = useEmailTemplates();
  const save = useUpsertEmailTemplate();
  const del = useDeleteEmailTemplate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EmailTemplateRow | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Email templates. Use <code className="font-mono text-xs bg-muted px-1 rounded">{'{{varName}}'}</code> to interpolate variables.
        </p>
        {!creating && !editing && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New template
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <TemplateForm
          initial={editing ? rowToForm(editing) : EMPTY}
          existing={!!editing}
          submitting={save.isPending}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSubmit={(data) => save.mutate({
            key: data.key,
            name: data.name,
            subject: data.subject,
            body: data.body,
            variables: data.variables.split(',').map((s) => s.trim()).filter(Boolean),
            description: data.description || undefined,
            isActive: data.isActive,
          }, {
            onSuccess: () => {
              toast.success('Template saved');
              setCreating(false); setEditing(null);
            },
            onError: (e) => toast.error(e.message),
          })}
        />
      )}

      <Card>
        <CardContent className="p-0 divide-y">
          {templates?.map((t) => (
            <div key={t.id} className="p-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Mail className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium">{t.name}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">{t.key}</Badge>
                  <Badge variant={t.isActive ? 'success' : 'secondary'} className="text-[10px]">
                    {t.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.subject}</p>
                {t.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {t.variables.map((v) => (
                      <code key={v} className="text-[10px] bg-muted px-1.5 rounded font-mono">{`{{${v}}}`}</code>
                    ))}
                  </div>
                )}
                {t.description && <p className="text-[11px] text-muted-foreground italic mt-1">{t.description}</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => {
                    if (!confirm(`Delete template "${t.name}"?`)) return;
                    del.mutate(t.id, {
                      onSuccess: () => toast.success('Deleted'),
                      onError: (e) => toast.error(e.message),
                    });
                  }}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          {!templates?.length && (
            <div className="p-10 text-center text-sm italic text-muted-foreground">No templates yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function rowToForm(t: EmailTemplateRow): Form {
  return {
    key: t.key,
    name: t.name,
    subject: t.subject,
    body: t.body,
    variables: t.variables.join(', '),
    description: t.description ?? '',
    isActive: t.isActive,
  };
}

function TemplateForm({ initial, existing, onSubmit, onCancel, submitting }: {
  initial: Form;
  existing?: boolean;
  onSubmit: (data: Form) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<Form>(initial);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">{existing ? `Edit "${initial.name}"` : 'New email template'}</CardTitle>
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="h-3.5 w-3.5" /></Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Key (slug)</Label>
              <Input value={form.key} onChange={(e) => set('key', e.target.value)}
                required disabled={existing} className="font-mono"
                placeholder="welcome / trial_ending / payment_failed" />
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </div>
          </div>
          <div>
            <Label className="text-xs">Subject</Label>
            <Input value={form.subject} onChange={(e) => set('subject', e.target.value)} required />
          </div>
          <div>
            <Label className="text-xs">Body (markdown / HTML)</Label>
            <textarea value={form.body} onChange={(e) => set('body', e.target.value)} required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[200px] font-mono"
              placeholder={'Hi {{name}},\n\nWelcome to Orca! Your free trial ends on {{trialEndDate}}.\n\n— The Orca team'} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Variables (comma-separated)</Label>
              <Input value={form.variables} onChange={(e) => set('variables', e.target.value)}
                placeholder="name, trialEndDate" />
            </div>
            <div>
              <Label className="text-xs">Description (internal)</Label>
              <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)} />
            Active
          </label>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : existing ? 'Save changes' : 'Create template'}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
