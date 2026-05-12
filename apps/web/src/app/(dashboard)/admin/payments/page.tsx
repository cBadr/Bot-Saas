'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAdminPayments, useRefundPayment } from '@/lib/queries-v2';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Download, RotateCcw, X } from 'lucide-react';

const STATUSES = ['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED', 'REFUNDED'];
const PAGE_SIZE = 50;

export default function AdminPaymentsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const { data } = useAdminPayments({
    search: search || undefined,
    status: status || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const refund = useRefundPayment();
  const [exporting, setExporting] = useState(false);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const summary = data?.summary;

  const filtersActive = !!(status || from || to || search);

  async function exportRevenue() {
    setExporting(true);
    try {
      const res = await api.get('/admin/revenue/export.csv', { responseType: 'blob' });
      const blob = new Blob([res.data]);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `revenue-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('Revenue CSV downloaded');
    } catch (e: unknown) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Completed (filtered)" value={summary ? formatCurrency(summary.completedTotalUsd) : '—'} sub={summary ? `${summary.completedCount} payments` : ''} />
        <Stat label="Total rows" value={String(total)} />
        <Stat label="Page" value={`${Math.floor(offset / PAGE_SIZE) + 1} / ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search by email or txn id…"
          value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="max-w-xs" />
        <select className="h-8 rounded-md border bg-background px-2 text-xs"
          value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">Status: any</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs">
          From: <input type="date" className="h-8 rounded-md border bg-background px-2 text-xs"
            value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} />
        </label>
        <label className="flex items-center gap-1 text-xs">
          To: <input type="date" className="h-8 rounded-md border bg-background px-2 text-xs"
            value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} />
        </label>
        {filtersActive && (
          <Button size="sm" variant="ghost"
            onClick={() => { setSearch(''); setStatus(''); setFrom(''); setTo(''); setOffset(0); }}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        )}
        <Button size="sm" variant="outline" className="ml-auto"
          onClick={exportRevenue} disabled={exporting}>
          <Download className="h-3.5 w-3.5 mr-1" />
          {exporting ? 'Exporting…' : 'Revenue CSV'}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">User</th>
                <th className="text-right px-3 py-2">USD</th>
                <th className="text-left px-3 py-2">Crypto</th>
                <th className="text-left px-3 py-2">Provider</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                    {new Date(p.createdAt).toLocaleDateString()}
                    {p.paidAt && <div className="text-[10px] text-muted-foreground">paid {new Date(p.paidAt).toLocaleDateString()}</div>}
                  </td>
                  <td className="px-3 py-1.5">
                    <Link href={`/admin/users/${p.user.id}`} className="text-xs font-mono hover:underline">
                      {p.user.email}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{formatCurrency(Number(p.amountUsd))}</td>
                  <td className="px-3 py-1.5 text-[11px] font-mono">
                    {p.amountCrypto ? `${formatNumber(Number(p.amountCrypto), { maximumFractionDigits: 8 })} ${p.cryptoCurrency ?? ''}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{p.provider}</td>
                  <td className="px-3 py-1.5">
                    <Badge
                      variant={p.status === 'COMPLETED' ? 'success'
                        : p.status === 'FAILED' || p.status === 'EXPIRED' ? 'destructive'
                        : 'outline'}
                      className="text-[10px]">
                      {p.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {p.status === 'COMPLETED' && (
                      <Button size="sm" variant="ghost"
                        disabled={refund.isPending}
                        onClick={() => {
                          const reason = prompt('Reason for refund?');
                          if (!reason) return;
                          if (!confirm(`Refund ${formatCurrency(Number(p.amountUsd))}? This marks the bookkeeping side only — actually returning funds must be done in the payment provider.`)) return;
                          refund.mutate({ id: p.id, reason }, {
                            onSuccess: () => toast.success('Refund recorded'),
                            onError: (e) => toast.error(e.message),
                          });
                        }}>
                        <RotateCcw className="h-3 w-3 text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="text-center text-muted-foreground text-sm py-10 italic">No payments match the filters.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
