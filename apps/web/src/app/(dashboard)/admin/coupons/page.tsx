'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  useCoupons, useCreateCoupon, useUpdateCoupon, useDeleteCoupon,
  type CouponRow,
} from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Pencil, Plus, Trash2, X, Tag } from 'lucide-react';

type Form = {
  code: string; description: string;
  discountType: 'PERCENT' | 'FIXED'; discountValue: number;
  applicablePlans: string;  // CSV in form
  maxRedemptions: string;   // empty = unlimited
  perUserLimit: number;
  validUntil: string;
  isActive: boolean;
};
const EMPTY: Form = {
  code: '', description: '',
  discountType: 'PERCENT', discountValue: 10,
  applicablePlans: '', maxRedemptions: '', perUserLimit: 1,
  validUntil: '', isActive: true,
};

export default function AdminCouponsPage() {
  const { data: coupons } = useCoupons();
  const create = useCreateCoupon();
  const update = useUpdateCoupon();
  const del = useDeleteCoupon();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CouponRow | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Coupon codes — fixed or percentage discounts on selected plans.</p>
        {!creating && !editing && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New coupon
          </Button>
        )}
      </div>

      {creating && (
        <CouponForm
          initial={EMPTY}
          submitting={create.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(data) => create.mutate({
            code: data.code,
            description: data.description || undefined,
            discountType: data.discountType,
            discountValue: data.discountValue,
            applicablePlans: data.applicablePlans.split(',').map((s) => s.trim()).filter(Boolean),
            maxRedemptions: data.maxRedemptions === '' ? undefined : Number(data.maxRedemptions),
            perUserLimit: data.perUserLimit,
            validUntil: data.validUntil || undefined,
            isActive: data.isActive,
          }, {
            onSuccess: () => { toast.success('Coupon created'); setCreating(false); },
            onError: (e) => toast.error(e.message),
          })}
        />
      )}
      {editing && (
        <CouponForm
          initial={rowToForm(editing)}
          existing
          submitting={update.isPending}
          onCancel={() => setEditing(null)}
          onSubmit={(data) => {
            update.mutate({
              id: editing.id,
              description: data.description,
              applicablePlans: data.applicablePlans.split(',').map((s) => s.trim()).filter(Boolean),
              maxRedemptions: data.maxRedemptions === '' ? null : Number(data.maxRedemptions),
              perUserLimit: data.perUserLimit,
              validUntil: data.validUntil || null,
              isActive: data.isActive,
            }, {
              onSuccess: () => { toast.success('Coupon updated'); setEditing(null); },
              onError: (e) => toast.error(e.message),
            });
          }}
        />
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Discount</th>
                <th className="text-left px-3 py-2">Plans</th>
                <th className="text-right px-3 py-2">Used</th>
                <th className="text-left px-3 py-2">Expires</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons?.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-1.5">
                    <div className="font-mono font-medium flex items-center gap-1.5">
                      <Tag className="h-3 w-3 text-primary" /> {c.code}
                    </div>
                    {c.description && <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{c.description}</div>}
                  </td>
                  <td className="px-3 py-1.5 font-mono">
                    {c.discountType === 'PERCENT'
                      ? `${Number(c.discountValue)}%`
                      : `$${Number(c.discountValue).toFixed(2)}`}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {c.applicablePlans.length === 0 ? <span className="text-muted-foreground italic">any</span> : (
                      <div className="flex flex-wrap gap-0.5">
                        {c.applicablePlans.map((p) => <Badge key={p} variant="outline" className="text-[9px] font-mono">{p}</Badge>)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {c.redemptionCount}{c.maxRedemptions ? `/${c.maxRedemptions}` : ''}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {c.validUntil ? new Date(c.validUntil).toLocaleDateString() : <span className="text-muted-foreground italic">never</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant={c.isActive ? 'success' : 'secondary'} className="text-[10px]">
                      {c.isActive ? 'Active' : 'Disabled'}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost"
                        onClick={() => {
                          if (!confirm(`Delete coupon "${c.code}"? All redemption records will also be removed.`)) return;
                          del.mutate(c.id, {
                            onSuccess: () => toast.success('Coupon deleted'),
                            onError: (e) => toast.error(e.message),
                          });
                        }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!coupons?.length && (
                <tr><td colSpan={7} className="text-center text-muted-foreground py-10 italic text-sm">No coupons yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function rowToForm(c: CouponRow): Form {
  return {
    code: c.code,
    description: c.description ?? '',
    discountType: c.discountType,
    discountValue: Number(c.discountValue),
    applicablePlans: c.applicablePlans.join(', '),
    maxRedemptions: c.maxRedemptions !== null ? String(c.maxRedemptions) : '',
    perUserLimit: c.perUserLimit,
    validUntil: c.validUntil ? c.validUntil.slice(0, 10) : '',
    isActive: c.isActive,
  };
}

function CouponForm({ initial, existing, onSubmit, onCancel, submitting }: {
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
    onSubmit({
      ...form,
      code: form.code.toUpperCase().trim(),
      description: form.description.trim(),
    });
  }

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">{existing ? `Edit ${initial.code}` : 'New coupon'}</CardTitle>
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="h-3.5 w-3.5" /></Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Code</Label>
            <Input value={form.code} onChange={(e) => set('code', e.target.value)}
              required disabled={existing} className="font-mono uppercase" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Discount type</Label>
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm mt-1"
              value={form.discountType}
              disabled={existing}
              onChange={(e) => set('discountType', e.target.value as 'PERCENT' | 'FIXED')}>
              <option value="PERCENT">PERCENT (0-100%)</option>
              <option value="FIXED">FIXED (USD)</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Value</Label>
            <Input type="number" step="0.01" min="0" required
              value={form.discountValue}
              disabled={existing}
              onChange={(e) => set('discountValue', Number(e.target.value))} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Applicable plan codes (comma-separated, empty = all)</Label>
            <Input value={form.applicablePlans} onChange={(e) => set('applicablePlans', e.target.value)}
              placeholder="pro, elite" />
          </div>
          <div>
            <Label className="text-xs">Max redemptions (empty = unlimited)</Label>
            <Input type="number" min="1" value={form.maxRedemptions}
              onChange={(e) => set('maxRedemptions', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Per-user limit</Label>
            <Input type="number" min="1" value={form.perUserLimit}
              onChange={(e) => set('perUserLimit', Number(e.target.value))} required />
          </div>
          <div>
            <Label className="text-xs">Valid until (optional)</Label>
            <Input type="date" value={form.validUntil}
              onChange={(e) => set('validUntil', e.target.value)} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => set('isActive', e.target.checked)} />
              Active
            </label>
          </div>
          <div className="md:col-span-2 flex gap-2 pt-1">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : existing ? 'Save changes' : 'Create coupon'}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
