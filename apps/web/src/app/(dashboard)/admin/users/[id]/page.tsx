'use client';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import {
  useAdminUserDetail, useResetUserMfa, useUpdateUserRole, useUpdateUserStatus, useImpersonate,
  useAdminResetPassword, useAdminChangeEmail, useSetUserNotes, useExtendSubscription,
} from '@/lib/queries-v2';
import { tokenStore } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatNumber, formatRelativeTime } from '@/lib/utils';
import { ArrowLeft, ShieldOff, UserCheck, KeyRound, Mail, StickyNote, Calendar } from 'lucide-react';

const ROLES = ['USER', 'PRO', 'ADMIN', 'SUPER_ADMIN'] as const;
const STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED', 'PENDING_VERIFICATION'] as const;

export default function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data } = useAdminUserDetail(id);
  const setRole = useUpdateUserRole();
  const setStatus = useUpdateUserStatus();
  const resetMfa = useResetUserMfa();
  const impersonate = useImpersonate();
  const resetPw = useAdminResetPassword();
  const changeEmail = useAdminChangeEmail();
  const setNotes = useSetUserNotes();
  const extendSub = useExtendSubscription();

  const [newEmail, setNewEmail] = useState('');
  const [notes, setNotesText] = useState('');
  const [tagsCsv, setTagsCsv] = useState('');
  useEffect(() => {
    if (!data?.user) return;
    setNewEmail(data.user.email);
    const admin = (data.user as unknown as { notificationConfig?: { admin?: { notes?: string; tags?: string[] } } })
      .notificationConfig?.admin;
    setNotesText(admin?.notes ?? '');
    setTagsCsv((admin?.tags ?? []).join(', '));
  }, [data?.user]);

  if (!data) return <p className="text-muted-foreground">Loading…</p>;
  const u = data.user;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold truncate">{u.fullName ?? u.email}</h2>
            <Badge variant={u.role === 'SUPER_ADMIN' ? 'default' : u.role === 'ADMIN' ? 'warning' : 'secondary'}>{u.role}</Badge>
            <Badge variant={u.status === 'ACTIVE' ? 'success' : 'destructive'}>{u.status}</Badge>
            {u.twoFactorEnabled && <Badge variant="outline">2FA</Badge>}
          </div>
          <p className="text-xs text-muted-foreground font-mono">{u.email} · {u.id}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Bots" value={String(data.bots.length)} />
        <Stat label="API Keys" value={String(data.apiKeys.length)} />
        <Stat label="Total trades" value={formatNumber(data.totals.trades)} />
        <Stat label="Total volume" value={formatNumber(data.totals.volume, { maximumFractionDigits: 0 })} />
      </div>

      {/* Quick admin actions */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Admin actions</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <label className="text-xs flex items-center gap-1.5">
            Role:
            <select className="h-8 rounded-md border bg-background px-2 text-xs"
              value={u.role}
              onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value }, {
                onSuccess: () => toast.success('Role updated'),
                onError: (err) => toast.error(err.message),
              })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="text-xs flex items-center gap-1.5">
            Status:
            <select className="h-8 rounded-md border bg-background px-2 text-xs"
              value={u.status}
              onChange={(e) => setStatus.mutate({ id: u.id, status: e.target.value }, {
                onSuccess: () => toast.success('Status updated'),
                onError: (err) => toast.error(err.message),
              })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {u.twoFactorEnabled && (
            <Button size="sm" variant="outline"
              disabled={resetMfa.isPending}
              onClick={() => {
                if (!confirm('Reset this user\'s 2FA? They will need to set it up again on next login.')) return;
                resetMfa.mutate(u.id, {
                  onSuccess: () => toast.success('2FA reset'),
                  onError: (e) => toast.error(e.message),
                });
              }}>
              <ShieldOff className="h-3.5 w-3.5 mr-1" /> Reset 2FA
            </Button>
          )}
          {u.status === 'ACTIVE' && u.role !== 'SUPER_ADMIN' && (
            <Button size="sm" variant="outline"
              disabled={impersonate.isPending}
              onClick={() => {
                if (!confirm(`Sign in as ${u.email}? Your admin session is saved and restorable from the banner.`)) return;
                impersonate.mutate(u.id, {
                  onSuccess: (data) => {
                    tokenStore.startImpersonation(data.accessToken, data.targetEmail);
                    toast.success(`Now signed in as ${data.targetEmail}`);
                    if (typeof window !== 'undefined') window.location.href = '/dashboard';
                  },
                  onError: (e) => toast.error(e.message),
                });
              }}>
              <UserCheck className="h-3.5 w-3.5 mr-1" /> Sign in as user
            </Button>
          )}
          <Button size="sm" variant="outline"
            disabled={resetPw.isPending}
            onClick={() => {
              if (!confirm(`Generate a 1-hour password reset link for ${u.email}?`)) return;
              resetPw.mutate(u.id, {
                onSuccess: (r) => {
                  navigator.clipboard.writeText(r.resetUrl).catch(() => undefined);
                  toast.success('Reset link copied to clipboard (expires in 60 minutes)');
                },
                onError: (e) => toast.error(e.message),
              });
            }}>
            <KeyRound className="h-3.5 w-3.5 mr-1" /> Reset password
          </Button>
        </CardContent>
      </Card>

      {/* Change email */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4" /> Change email</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
            type="email" className="font-mono max-w-sm" />
          <Button size="sm" disabled={changeEmail.isPending || newEmail === u.email || !newEmail.includes('@')}
            onClick={() => {
              if (!confirm(`Change email from ${u.email} to ${newEmail}? User must re-verify.`)) return;
              changeEmail.mutate({ id: u.id, email: newEmail }, {
                onSuccess: () => toast.success('Email changed'),
                onError: (e) => toast.error(e.message),
              });
            }}>
            Save
          </Button>
        </CardContent>
      </Card>

      {/* Extend subscription */}
      {data.subscriptions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Calendar className="h-4 w-4" /> Extend subscription</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 flex-wrap">
            {data.subscriptions.map((s) => (
              <div key={s.id} className="flex items-center gap-2 border rounded-md px-2.5 py-1.5">
                <span className="text-xs font-medium">{s.plan.name}</span>
                <Badge variant="outline" className="text-[9px]">{s.status}</Badge>
                <span className="text-[10px] text-muted-foreground">
                  ends {new Date(s.endsAt).toLocaleDateString()}
                </span>
                <Button size="sm" variant="ghost"
                  disabled={extendSub.isPending}
                  onClick={() => {
                    const daysStr = prompt('Extend by how many days?', '30');
                    if (!daysStr) return;
                    const days = Number(daysStr);
                    if (!Number.isFinite(days) || days < 1) { toast.error('Invalid days'); return; }
                    extendSub.mutate({ id: s.id, days }, {
                      onSuccess: () => toast.success(`Extended by ${days} day(s)`),
                      onError: (e) => toast.error(e.message),
                    });
                  }}>
                  +days
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Notes & tags */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><StickyNote className="h-4 w-4" /> Admin notes</CardTitle>
          <CardDescription className="text-xs">Internal only — never shown to the user.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Tags (comma-separated)</Label>
            <Input value={tagsCsv} onChange={(e) => setTagsCsv(e.target.value)}
              placeholder="VIP, support-priority, suspicious" />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <textarea value={notes} onChange={(e) => setNotesText(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[100px] font-mono"
              placeholder="Context, history, escalation notes…" />
          </div>
          <Button size="sm" disabled={setNotes.isPending}
            onClick={() => {
              const tags = tagsCsv.split(',').map((t) => t.trim()).filter(Boolean);
              setNotes.mutate({ id: u.id, notes, tags }, {
                onSuccess: () => toast.success('Saved'),
                onError: (e) => toast.error(e.message),
              });
            }}>
            Save notes
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bots */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Bots ({data.bots.length})</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[260px] overflow-y-auto">
            {data.bots.length === 0 ? <p className="p-3 text-xs italic text-muted-foreground">No bots.</p> : (
              data.bots.map((b) => (
                <Link key={b.id} href={`/bots/${b.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 border-b last:border-0 text-xs hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{b.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{b.symbol}</div>
                  </div>
                  <Badge variant="outline" className="text-[9px]">{b.status}</Badge>
                  <span className={`font-mono text-[11px] tabular-nums ${Number(b.realizedPnlQuote) >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {Number(b.realizedPnlQuote) >= 0 ? '+' : ''}{formatNumber(Number(b.realizedPnlQuote), { maximumFractionDigits: 2 })}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Subscriptions */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Subscriptions ({data.subscriptions.length})</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[260px] overflow-y-auto">
            {data.subscriptions.length === 0 ? <p className="p-3 text-xs italic text-muted-foreground">No subscriptions.</p> : (
              data.subscriptions.map((s) => (
                <div key={s.id} className="px-3 py-1.5 border-b last:border-0 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{s.plan.name}</span>
                    <Badge variant="outline" className="text-[9px]">{s.status}</Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    ${s.plan.priceUsd} · ends {new Date(s.endsAt).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Payments */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recent payments ({data.payments.length})</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[260px] overflow-y-auto">
            {data.payments.length === 0 ? <p className="p-3 text-xs italic text-muted-foreground">No payments.</p> : (
              data.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-3 py-1.5 border-b last:border-0 text-xs">
                  <div>
                    <div className="font-mono">{formatCurrency(Number(p.amountUsd))}</div>
                    <div className="text-[10px] text-muted-foreground">{p.provider} · {new Date(p.createdAt).toLocaleDateString()}</div>
                  </div>
                  <Badge variant={p.status === 'COMPLETED' ? 'success' : p.status === 'FAILED' ? 'destructive' : 'outline'} className="text-[9px]">
                    {p.status}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Active sessions */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Active sessions ({data.sessions.length})</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[260px] overflow-y-auto">
            {data.sessions.length === 0 ? <p className="p-3 text-xs italic text-muted-foreground">No active sessions.</p> : (
              data.sessions.map((s) => (
                <div key={s.id} className="px-3 py-1.5 border-b last:border-0 text-xs">
                  <div className="truncate">{s.userAgent ?? 'Unknown'}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {s.ipAddress ?? '—'} · {new Date(s.createdAt).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audit */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent audit activity</CardTitle>
          <CardDescription className="text-xs">Last 30 events touching this user.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 max-h-[260px] overflow-y-auto">
          {data.recentAudit.length === 0 ? <p className="p-3 text-xs italic text-muted-foreground">No activity.</p> : (
            data.recentAudit.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b last:border-0 text-xs">
                <Badge variant="outline" className="text-[9px] font-mono">{e.action}</Badge>
                <span className="text-[10px] text-muted-foreground">{formatRelativeTime(e.createdAt)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
