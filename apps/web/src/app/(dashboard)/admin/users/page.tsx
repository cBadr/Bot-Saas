'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAdminUsers, useUpdateUserRole, useUpdateUserStatus } from '@/lib/queries-v2';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/utils';

const ROLES = ['USER', 'PRO', 'ADMIN', 'SUPER_ADMIN'] as const;
const STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED', 'PENDING_VERIFICATION'] as const;

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const { data: users } = useAdminUsers(search || undefined);
  const setRole = useUpdateUserRole();
  const setStatus = useUpdateUserStatus();

  return (
    <div className="space-y-4">
      <Input placeholder="Search by email or name…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      <Card>
        <CardContent className="p-0 divide-y">
          {users?.map((u) => (
            <div key={u.id} className="p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{u.fullName ?? '—'}</span>
                  <Badge variant={u.role === 'SUPER_ADMIN' ? 'default' : u.role === 'ADMIN' ? 'warning' : 'secondary'}>{u.role}</Badge>
                  <Badge variant={u.status === 'ACTIVE' ? 'success' : 'destructive'}>{u.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {u.email} · {u._count.bots} bots · {u._count.apiKeys} keys
                  {u.lastLoginAt && <> · last login {formatRelativeTime(u.lastLoginAt)}</>}
                </div>
              </div>
              <div className="flex gap-2">
                <select className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={u.role}
                  onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value }, {
                    onSuccess: () => toast.success('Role updated'),
                    onError: (err) => toast.error(err.message),
                  })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={u.status}
                  onChange={(e) => setStatus.mutate({ id: u.id, status: e.target.value }, {
                    onSuccess: () => toast.success('Status updated'),
                    onError: (err) => toast.error(err.message),
                  })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          ))}
          {!users?.length && <div className="p-12 text-center text-muted-foreground">No users found.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
