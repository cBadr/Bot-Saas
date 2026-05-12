'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAdminPlans, useCreatePlan, useUpdatePlan } from '@/lib/queries-v2';
import type { Plan } from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Pencil, Plus, X } from 'lucide-react';

type Form = {
  code: string; name: string; description: string;
  priceUsd: number; billingCycleDays: number;
  maxBots: number; maxApiKeys: number; maxCustomStrategies: number;
  sortOrder: number; isActive: boolean;
};

const EMPTY: Form = {
  code: '', name: '', description: '',
  priceUsd: 0, billingCycleDays: 30,
  maxBots: 1, maxApiKeys: 1, maxCustomStrategies: 0,
  sortOrder: 0, isActive: true,
};

export default function AdminPlansPage() {
  const { data: plans } = useAdminPlans();
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage subscription plans, pricing, and per-plan limits.</p>
        {!creating && !editing && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New plan
          </Button>
        )}
      </div>

      {creating && (
        <PlanForm
          initial={EMPTY}
          submitting={create.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(data) => create.mutate(data, {
            onSuccess: () => { toast.success('Plan created'); setCreating(false); },
            onError: (e) => toast.error(e.message),
          })}
        />
      )}

      {editing && (
        <PlanForm
          initial={planToForm(editing)}
          submitting={update.isPending}
          onCancel={() => setEditing(null)}
          onSubmit={(data) => {
            const { code, ...patch } = data;  // code is immutable on update
            void code;
            update.mutate({ id: editing.id, ...patch }, {
              onSuccess: () => { toast.success('Plan updated'); setEditing(null); },
              onError: (e) => toast.error(e.message),
            });
          }}
        />
      )}

      <Card>
        <CardContent className="p-0 divide-y">
          {plans?.map((p) => (
            <div key={p.id} className="p-3 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{p.name}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">{p.code}</Badge>
                  <Badge variant={p.isActive ? 'success' : 'secondary'} className="text-[10px]">
                    {p.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  ${Number(p.priceUsd).toFixed(2)} / {p.billingCycleDays}d ·
                  {p.maxBots} bots · {p.maxApiKeys} keys · {p.maxCustomStrategies} custom strats
                </div>
                {p.description && <p className="text-[11px] text-muted-foreground mt-0.5">{p.description}</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {!plans?.length && <div className="p-8 text-center text-sm text-muted-foreground italic">No plans yet.</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function planToForm(p: Plan): Form {
  return {
    code: p.code,
    name: p.name,
    description: p.description ?? '',
    priceUsd: Number(p.priceUsd),
    billingCycleDays: p.billingCycleDays,
    maxBots: p.maxBots,
    maxApiKeys: p.maxApiKeys,
    maxCustomStrategies: p.maxCustomStrategies,
    sortOrder: p.sortOrder,
    isActive: p.isActive,
  };
}

function PlanForm({ initial, onSubmit, onCancel, submitting }: {
  initial: Form;
  onSubmit: (data: Form) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<Form>(initial);
  const isEdit = !!initial.code;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">{isEdit ? `Edit "${initial.name}"` : 'New plan'}</CardTitle>
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="h-3.5 w-3.5" /></Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <Field label="Code (slug)" hint="Immutable after creation.">
            <Input value={form.code} onChange={(e) => set('code', e.target.value)}
              disabled={isEdit} required className="font-mono" />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
          <Field label="Description" full>
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Price (USD)">
            <Input type="number" step="0.01" min="0" value={form.priceUsd}
              onChange={(e) => set('priceUsd', Number(e.target.value))} required />
          </Field>
          <Field label="Billing cycle (days)">
            <Input type="number" min="1" value={form.billingCycleDays}
              onChange={(e) => set('billingCycleDays', Number(e.target.value))} required />
          </Field>
          <Field label="Max bots">
            <Input type="number" min="0" value={form.maxBots}
              onChange={(e) => set('maxBots', Number(e.target.value))} required />
          </Field>
          <Field label="Max API keys">
            <Input type="number" min="0" value={form.maxApiKeys}
              onChange={(e) => set('maxApiKeys', Number(e.target.value))} required />
          </Field>
          <Field label="Max custom strategies">
            <Input type="number" min="0" value={form.maxCustomStrategies}
              onChange={(e) => set('maxCustomStrategies', Number(e.target.value))} required />
          </Field>
          <Field label="Sort order">
            <Input type="number" value={form.sortOrder}
              onChange={(e) => set('sortOrder', Number(e.target.value))} required />
          </Field>
          <Field label="Status" full>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              Active (visible to users)
            </label>
          </Field>
          <div className="md:col-span-2 flex gap-2 pt-1">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create plan'}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, full, children }: {
  label: string; hint?: string; full?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}
