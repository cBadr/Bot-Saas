'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAdminUsers, useUpdateUserRole, useUpdateUserStatus, useBulkUpdateUsers } from '@/lib/queries-v2';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/utils';
import { ChevronLeft, ChevronRight, ExternalLink, Filter, X } from 'lucide-react';

const ROLES = ['USER', 'PRO', 'ADMIN', 'SUPER_ADMIN'] as const;
const STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED', 'PENDING_VERIFICATION'] as const;
const PAGE_SIZE = 50;

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [hasBots, setHasBots] = useState<'' | 'true' | 'false'>('');
  const [twoFactor, setTwoFactor] = useState<'' | 'true' | 'false'>('');
  const [offset, setOffset] = useState(0);

  const params = {
    search: search || undefined,
    role: role || undefined,
    status: status || undefined,
    hasBots: hasBots === '' ? undefined : hasBots === 'true',
    twoFactor: twoFactor === '' ? undefined : twoFactor === 'true',
    limit: PAGE_SIZE,
    offset,
  };
  const { data } = useAdminUsers(params);
  const setRoleM = useUpdateUserRole();
  const setStatusM = useUpdateUserStatus();
  const bulk = useBulkUpdateUsers();
  const users = data?.rows ?? [];
  const total = data?.total ?? 0;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = users.length > 0 && users.every((u) => selected.has(u.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(users.map((u) => u.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const runBulk = (patch: { role?: string; status?: string }) => {
    const ids = [...selected];
    if (!ids.length) return;
    const label = patch.role ? `set role=${patch.role}` : `set status=${patch.status}`;
    if (!confirm(`Apply "${label}" to ${ids.length} user(s)?`)) return;
    bulk.mutate({ ids, ...patch }, {
      onSuccess: (r) => { toast.success(`Updated ${r.updated} user(s)`); setSelected(new Set()); },
      onError: (e) => toast.error(e.message),
    });
  };

  const filtersActive = !!(role || status || hasBots || twoFactor);
  const clearFilters = () => {
    setRole(''); setStatus(''); setHasBots(''); setTwoFactor(''); setOffset(0);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search email or name…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="max-w-xs"
        />
        <FilterSelect label="Role" value={role} options={ROLES} onChange={(v) => { setRole(v); setOffset(0); }} />
        <FilterSelect label="Status" value={status} options={STATUSES} onChange={(v) => { setStatus(v); setOffset(0); }} />
        <FilterSelect label="Has bots" value={hasBots} options={['true', 'false']} onChange={(v) => { setHasBots(v as never); setOffset(0); }} />
        <FilterSelect label="2FA" value={twoFactor} options={['true', 'false']} onChange={(v) => { setTwoFactor(v as never); setOffset(0); }} />
        {filtersActive && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {total > 0 ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}` : '—'}
        </span>
      </div>

      {/* Bulk action bar (shown when selection exists) */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <span className="mx-1 text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">Bulk:</span>
          <select className="h-8 rounded-md border bg-background px-2 text-xs"
            defaultValue=""
            onChange={(e) => { if (e.target.value) { runBulk({ status: e.target.value }); e.target.value = ''; } }}>
            <option value="">Set status…</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="h-8 rounded-md border bg-background px-2 text-xs"
            defaultValue=""
            onChange={(e) => { if (e.target.value) { runBulk({ role: e.target.value }); e.target.value = ''; } }}>
            <option value="">Set role…</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0 divide-y">
          {users.length > 0 && (
            <div className="px-3 py-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>Select all on page ({users.length})</span>
            </div>
          )}
          {users.map((u) => (
            <div key={u.id} className="p-3 flex items-center justify-between gap-4">
              <input
                type="checkbox"
                checked={selected.has(u.id)}
                onChange={() => toggleOne(u.id)}
                className="mt-1 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline truncate">
                    {u.fullName ?? u.email}
                  </Link>
                  <Badge variant={u.role === 'SUPER_ADMIN' ? 'default' : u.role === 'ADMIN' ? 'warning' : 'secondary'} className="text-[10px]">{u.role}</Badge>
                  <Badge variant={u.status === 'ACTIVE' ? 'success' : 'destructive'} className="text-[10px]">{u.status}</Badge>
                  {u.twoFactorEnabled && <Badge variant="outline" className="text-[10px]">2FA</Badge>}
                  {u.adminTags?.map((t) => (
                    <Badge key={t} variant="outline" className="text-[9px] bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400">
                      {t}
                    </Badge>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  <span className="font-mono">{u.email}</span> · {u._count.bots} bots · {u._count.apiKeys} keys
                  {u.lastLoginAt && <> · last login {formatRelativeTime(u.lastLoginAt)}</>}
                  {u.lastLoginIp && <span className="font-mono ml-1">({u.lastLoginIp})</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <select className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={u.role}
                  onChange={(e) => setRoleM.mutate({ id: u.id, role: e.target.value }, {
                    onSuccess: () => toast.success('Role updated'),
                    onError: (err) => toast.error(err.message),
                  })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={u.status}
                  onChange={(e) => setStatusM.mutate({ id: u.id, status: e.target.value }, {
                    onSuccess: () => toast.success('Status updated'),
                    onError: (err) => toast.error(err.message),
                  })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Link href={`/admin/users/${u.id}`}>
                  <Button size="sm" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /></Button>
                </Link>
              </div>
            </div>
          ))}
          {!users.length && <div className="p-12 text-center text-muted-foreground text-sm">No users match the filters.</div>}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <span className="text-xs text-muted-foreground">Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
          <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: readonly string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Filter className="h-3.5 w-3.5 text-muted-foreground" />
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}>
        <option value="">{label}: any</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
