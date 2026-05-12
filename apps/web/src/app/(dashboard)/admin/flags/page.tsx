'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAdminFlags, useToggleFlag, useSetFlagExtended, type FeatureFlagRow } from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Pencil, Plus, Target, X } from 'lucide-react';

const ROLES = ['USER', 'PRO', 'ADMIN', 'SUPER_ADMIN'] as const;

export default function AdminFlagsPage() {
  const { data: flags } = useAdminFlags();
  const toggle = useToggleFlag();
  const setExtended = useSetFlagExtended();
  const [newKey, setNewKey] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editing, setEditing] = useState<FeatureFlagRow | null>(null);

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
          <Button onClick={create}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Create
          </Button>
        </CardContent>
      </Card>

      {editing && (
        <TargetingForm
          flag={editing}
          submitting={setExtended.isPending}
          onCancel={() => setEditing(null)}
          onSubmit={(patch) => setExtended.mutate({ key: editing.key, ...patch }, {
            onSuccess: () => { toast.success('Targeting saved'); setEditing(null); },
            onError: (e) => toast.error(e.message),
          })}
        />
      )}

      <Card>
        <CardContent className="p-0 divide-y">
          {flags?.map((f) => (
            <div key={f.key} className="p-4 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-sm">{f.key}</code>
                  <Badge variant={f.enabled ? 'success' : 'secondary'}>{f.enabled ? 'On' : 'Off'}</Badge>
                  {f.rolloutPct > 0 && <Badge variant="outline">{f.rolloutPct}% rollout</Badge>}
                  {f.allowList.length > 0 && <Badge variant="outline">{f.allowList.length} on allowList</Badge>}
                  {hasTargeting(f.targeting) && (
                    <Badge variant="outline" className="text-[10px] bg-primary/10">
                      <Target className="h-3 w-3 mr-1" /> targeted
                    </Badge>
                  )}
                </div>
                {f.description && <p className="text-xs text-muted-foreground mt-1">{f.description}</p>}
                <TargetingSummary t={f.targeting} />
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setEditing(f)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="sm"
                  onClick={() => toggle.mutate({ key: f.key, enabled: !f.enabled }, {
                    onSuccess: () => toast.success(`${f.key} ${!f.enabled ? 'enabled' : 'disabled'}`),
                  })}>
                  {f.enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
          ))}
          {!flags?.length && <div className="p-12 text-center text-muted-foreground">No feature flags yet.</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function hasTargeting(t: FeatureFlagRow['targeting']): boolean {
  return !!(t?.roles?.length || t?.plans?.length || t?.countries?.length
    || t?.signupAfter || t?.signupBefore || t?.minBots || t?.trialOnly);
}

function TargetingSummary({ t }: { t: FeatureFlagRow['targeting'] }) {
  if (!hasTargeting(t)) return null;
  const parts: string[] = [];
  if (t.roles?.length) parts.push(`roles: ${t.roles.join(', ')}`);
  if (t.plans?.length) parts.push(`plans: ${t.plans.join(', ')}`);
  if (t.countries?.length) parts.push(`countries: ${t.countries.join(', ')}`);
  if (t.signupAfter) parts.push(`signed up after ${t.signupAfter.slice(0, 10)}`);
  if (t.signupBefore) parts.push(`signed up before ${t.signupBefore.slice(0, 10)}`);
  if (t.minBots !== undefined) parts.push(`≥${t.minBots} bots`);
  if (t.trialOnly) parts.push('trial only');
  return <p className="text-[10px] text-muted-foreground mt-1 font-mono">→ {parts.join(' · ')}</p>;
}

function TargetingForm({ flag, onSubmit, onCancel, submitting }: {
  flag: FeatureFlagRow;
  onSubmit: (patch: {
    rolloutPct?: number;
    allowList?: string[];
    description?: string;
    targeting?: {
      roles?: string[]; plans?: string[]; countries?: string[];
      signupAfter?: string; signupBefore?: string;
      minBots?: number; trialOnly?: boolean;
    };
  }) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [rolloutPct, setRolloutPct] = useState(flag.rolloutPct);
  const [allowListCsv, setAllowListCsv] = useState(flag.allowList.join(', '));
  const [description, setDescription] = useState(flag.description ?? '');
  const t = flag.targeting ?? {};
  const [roles, setRoles] = useState<string[]>(t.roles ?? []);
  const [plansCsv, setPlansCsv] = useState((t.plans ?? []).join(', '));
  const [countriesCsv, setCountriesCsv] = useState((t.countries ?? []).join(', '));
  const [signupAfter, setSignupAfter] = useState(t.signupAfter?.slice(0, 10) ?? '');
  const [signupBefore, setSignupBefore] = useState(t.signupBefore?.slice(0, 10) ?? '');
  const [minBots, setMinBots] = useState<string>(t.minBots !== undefined ? String(t.minBots) : '');
  const [trialOnly, setTrialOnly] = useState(!!t.trialOnly);

  function toggleRole(r: string) {
    setRoles((rs) => rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      rolloutPct,
      allowList: allowListCsv.split(',').map((s) => s.trim()).filter(Boolean),
      description,
      targeting: {
        ...(roles.length ? { roles } : {}),
        ...(plansCsv.trim() ? { plans: plansCsv.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
        ...(countriesCsv.trim() ? { countries: countriesCsv.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) } : {}),
        ...(signupAfter ? { signupAfter: new Date(signupAfter).toISOString() } : {}),
        ...(signupBefore ? { signupBefore: new Date(signupBefore).toISOString() } : {}),
        ...(minBots !== '' ? { minBots: Number(minBots) } : {}),
        ...(trialOnly ? { trialOnly: true } : {}),
      },
    });
  }

  return (
    <Card className="border-primary/40">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4" /> Edit <code>{flag.key}</code>
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="h-3.5 w-3.5" /></Button>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Rollout %</Label>
              <Input type="number" min={0} max={100} value={rolloutPct}
                onChange={(e) => setRolloutPct(Number(e.target.value))} />
              <p className="text-[10px] text-muted-foreground mt-0.5">Percentage of eligible users to receive this flag.</p>
            </div>
            <div>
              <Label className="text-xs">Allow list (user IDs, comma-separated)</Label>
              <Input value={allowListCsv} onChange={(e) => setAllowListCsv(e.target.value)} />
            </div>
          </div>

          <div className="border-t pt-3 space-y-3">
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Targeting rules</h4>

            <div>
              <Label className="text-xs">Roles (restrict to)</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {ROLES.map((r) => (
                  <label key={r} className={`text-xs px-2 py-1 rounded border cursor-pointer ${
                    roles.includes(r) ? 'border-primary bg-primary/10 text-primary' : ''
                  }`}>
                    <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)}
                      className="mr-1.5" />
                    {r}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs">Plans (codes, CSV)</Label>
                <Input value={plansCsv} onChange={(e) => setPlansCsv(e.target.value)} placeholder="pro, elite" />
              </div>
              <div>
                <Label className="text-xs">Countries (ISO-2, CSV)</Label>
                <Input value={countriesCsv} onChange={(e) => setCountriesCsv(e.target.value)} placeholder="US, GB" />
              </div>
              <div>
                <Label className="text-xs">Signup after</Label>
                <Input type="date" value={signupAfter} onChange={(e) => setSignupAfter(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Signup before</Label>
                <Input type="date" value={signupBefore} onChange={(e) => setSignupBefore(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Min bots</Label>
                <Input type="number" min={0} value={minBots} onChange={(e) => setMinBots(e.target.value)} />
              </div>
              <div className="flex items-end">
                <label className="text-sm flex items-center gap-2">
                  <input type="checkbox" checked={trialOnly} onChange={(e) => setTrialOnly(e.target.checked)} />
                  Trial subscribers only
                </label>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save targeting'}</Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
