'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAdminBots, useForceStopBot, useTopBots, useAdminStrategyUsage } from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatNumber, formatRelativeTime } from '@/lib/utils';
import { Bot, ExternalLink, OctagonAlert, X, ChevronLeft, ChevronRight } from 'lucide-react';

const STATUSES = ['CREATED', 'STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'PAUSED', 'ERROR'];
const PAGE_SIZE = 50;

export default function AdminBotsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [symbol, setSymbol] = useState('');
  const [stuck, setStuck] = useState(false);
  const [offset, setOffset] = useState(0);

  const { data } = useAdminBots({
    search: search || undefined,
    status: status || undefined,
    symbol: symbol || undefined,
    stuck,
    limit: PAGE_SIZE,
    offset,
  });
  const { data: top } = useTopBots();
  const { data: strategyUsage } = useAdminStrategyUsage();
  const forceStop = useForceStopBot();

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-5">
      {/* Strategy usage + top winners/losers */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Strategy usage</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[200px] overflow-y-auto">
            {strategyUsage?.map((s) => (
              <div key={s.strategyId} className="flex items-center justify-between px-3 py-1.5 border-b last:border-0 text-xs">
                <span className="truncate">{s.name} {s.builtinKey && <Badge variant="outline" className="text-[9px] ml-1">{s.builtinKey}</Badge>}</span>
                <span className="font-mono tabular-nums">{s.count}</span>
              </div>
            )) ?? <p className="p-3 text-xs italic text-muted-foreground">No data.</p>}
          </CardContent>
        </Card>
        <TopBotsList title="Top winners" rows={top?.winners ?? []} positive />
        <TopBotsList title="Top losers" rows={top?.losers ?? []} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search name or symbol…"
          value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="max-w-xs" />
        <select className="h-8 rounded-md border bg-background px-2 text-xs"
          value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">Status: any</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Input placeholder="Symbol"
          value={symbol} onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setOffset(0); }}
          className="max-w-[140px]" />
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={stuck} onChange={(e) => { setStuck(e.target.checked); setOffset(0); }} />
          Stuck only
        </label>
        {(status || symbol || stuck || search) && (
          <Button size="sm" variant="ghost"
            onClick={() => { setSearch(''); setStatus(''); setSymbol(''); setStuck(false); setOffset(0); }}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {total > 0 ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}` : '—'}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Bot</th>
                <th className="text-left px-3 py-2">Owner</th>
                <th className="text-left px-3 py-2">Symbol</th>
                <th className="text-left px-3 py-2">Strategy</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Realized</th>
                <th className="text-left px-3 py-2">Updated</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-1.5">
                    <Link href={`/bots/${b.id}`} className="font-medium hover:underline flex items-center gap-1.5">
                      <Bot className="h-3 w-3" />
                      <span className="truncate max-w-[160px]">{b.name}</span>
                      {b.paperTrading && <Badge variant="outline" className="text-[9px]">paper</Badge>}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    <Link href={`/admin/users/${b.user.id}`} className="text-xs font-mono text-muted-foreground hover:underline truncate inline-block max-w-[180px]">
                      {b.user.email}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{b.symbol}</td>
                  <td className="px-3 py-1.5 text-xs">{b.strategy.builtinKey ?? b.strategy.name}</td>
                  <td className="px-3 py-1.5">
                    <Badge variant={b.status === 'RUNNING' ? 'success' : b.status === 'ERROR' ? 'destructive' : 'outline'} className="text-[10px]">
                      {b.status}
                    </Badge>
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums text-xs ${Number(b.realizedPnlQuote) >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {Number(b.realizedPnlQuote) >= 0 ? '+' : ''}{formatNumber(Number(b.realizedPnlQuote), { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-1.5 text-[10px] text-muted-foreground">{formatRelativeTime(b.updatedAt)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Link href={`/bots/${b.id}`}>
                        <Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button>
                      </Link>
                      {(b.status === 'RUNNING' || b.status === 'STARTING') && (
                        <Button size="sm" variant="ghost"
                          disabled={forceStop.isPending}
                          onClick={() => {
                            const reason = prompt('Reason for force-stop?');
                            if (!reason) return;
                            forceStop.mutate({ id: b.id, reason }, {
                              onSuccess: () => toast.success('Force-stop requested'),
                              onError: (e) => toast.error(e.message),
                            });
                          }}>
                          <OctagonAlert className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={8} className="text-center text-muted-foreground text-sm py-10 italic">No bots match the filters.</td></tr>
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
          <span className="text-xs text-muted-foreground">Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
          <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function TopBotsList({ title, rows, positive }: {
  title: string;
  rows: Array<{ id: string; name: string; symbol: string; pnl: number; owner: string }>;
  positive?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="p-0 max-h-[200px] overflow-y-auto">
        {rows.length === 0 ? <p className="p-3 text-xs italic text-muted-foreground">No data.</p> : (
          rows.map((b) => (
            <Link key={b.id} href={`/bots/${b.id}`}
              className="flex items-center justify-between px-3 py-1.5 border-b last:border-0 text-xs hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <div className="truncate">{b.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">{b.symbol} · {b.owner}</div>
              </div>
              <span className={`font-mono tabular-nums whitespace-nowrap ${positive ? 'text-success' : 'text-destructive'}`}>
                {b.pnl >= 0 ? '+' : ''}{formatNumber(b.pnl, { maximumFractionDigits: 2 })}
              </span>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
