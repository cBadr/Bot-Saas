'use client';
import { useState } from 'react';
import { useAdminAudit } from '@/lib/queries-v2';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/utils';
import { Download, X } from 'lucide-react';
import { toast } from 'sonner';

const ACTOR_TYPES = ['ADMIN', 'USER', 'SYSTEM'];

export default function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [actorType, setActorType] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const { data: logs } = useAdminAudit({
    action: action || undefined,
    actorType: actorType || undefined,
    userId: userId || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: 500,
  });
  const filtersActive = !!(action || actorType || userId || from || to);

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await api.get('/admin/audit/export.csv', { responseType: 'blob' });
      const blob = new Blob([res.data]);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `audit-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('Audit exported');
    } catch (e: unknown) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Action (contains…)"
          value={action} onChange={(e) => setAction(e.target.value)}
          className="max-w-[180px]" />
        <select className="h-8 rounded-md border bg-background px-2 text-xs"
          value={actorType} onChange={(e) => setActorType(e.target.value)}>
          <option value="">Actor: any</option>
          {ACTOR_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <Input placeholder="User ID"
          value={userId} onChange={(e) => setUserId(e.target.value)}
          className="max-w-[200px] font-mono text-xs" />
        <label className="flex items-center gap-1 text-xs">
          From: <input type="date" className="h-8 rounded-md border bg-background px-2 text-xs"
            value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-xs">
          To: <input type="date" className="h-8 rounded-md border bg-background px-2 text-xs"
            value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {filtersActive && (
          <Button size="sm" variant="ghost"
            onClick={() => { setAction(''); setActorType(''); setUserId(''); setFrom(''); setTo(''); }}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        )}
        <Button size="sm" variant="outline" className="ml-auto"
          onClick={exportCsv} disabled={exporting}>
          <Download className="h-3.5 w-3.5 mr-1" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Actor</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Target</th>
                <th className="text-left px-3 py-2">IP</th>
                <th className="text-left px-3 py-2">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs?.map((l) => (
                <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <div className="text-xs">{new Date(l.createdAt).toLocaleString()}</div>
                    <div className="text-[10px] text-muted-foreground">{formatRelativeTime(l.createdAt)}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant={l.actorType === 'ADMIN' ? 'warning' : l.actorType === 'SYSTEM' ? 'outline' : 'secondary'} className="text-[10px]">
                      {l.actorType}
                    </Badge>
                    {l.userId && (
                      <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">{l.userId}</div>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <code className="text-xs">{l.action}</code>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {l.targetType ? <>
                      {l.targetType}
                      {l.targetId && <span className="font-mono ml-1">{l.targetId.slice(0, 16)}</span>}
                    </> : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-[11px] font-mono text-muted-foreground">{l.ipAddress ?? '—'}</td>
                  <td className="px-3 py-1.5 text-[11px] text-muted-foreground font-mono truncate max-w-[280px]">
                    {l.metadata ? JSON.stringify(l.metadata).slice(0, 120) : '—'}
                  </td>
                </tr>
              ))}
              {!logs?.length && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-10 italic text-sm">No audit entries match the filters.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground italic">
        Showing up to 500 entries. Export CSV pulls up to 5,000.
      </p>
    </div>
  );
}
