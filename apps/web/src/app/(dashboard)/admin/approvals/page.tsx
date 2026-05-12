'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useApprovals, useApproveAction, useRejectAction } from '@/lib/queries-v2';
import { useMe } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/utils';
import { Check, X, Clock } from 'lucide-react';

type Tab = 'pending' | 'completed' | 'rejected';

export default function AdminApprovalsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const { data: me } = useMe();
  const { data: rows } = useApprovals(tab);
  const approve = useApproveAction();
  const reject = useRejectAction();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sensitive actions wait for a second admin's approval. The approver must differ from the requester.
      </p>

      <div className="flex gap-1 border-b">
        {(['pending', 'completed', 'rejected'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-primary text-foreground font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {rows?.map((a) => {
            const isMine = a.requestedBy === me?.id;
            const expired = new Date(a.expiresAt) < new Date();
            return (
              <div key={a.id} className="p-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] font-mono">{a.action}</Badge>
                    {a.targetType && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {a.targetType}:{a.targetId?.slice(0, 12)}
                      </span>
                    )}
                    {isMine && <Badge variant="outline" className="text-[9px] bg-muted">you requested</Badge>}
                    {expired && tab === 'pending' && <Badge variant="destructive" className="text-[9px]">expired</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Requested by <span className="font-mono">{a.requestedByUser.email}</span>
                    {' · '}{formatRelativeTime(a.createdAt)}
                    {a.expiresAt && tab === 'pending' && (
                      <> · expires {new Date(a.expiresAt).toLocaleString()}</>
                    )}
                  </div>
                  {a.reason && <p className="mt-1 text-xs italic">"{a.reason}"</p>}
                  <details className="mt-1">
                    <summary className="text-[10px] text-muted-foreground cursor-pointer">Payload</summary>
                    <pre className="text-[10px] bg-muted/40 p-2 rounded mt-1 overflow-x-auto font-mono">
                      {JSON.stringify(a.payload, null, 2)}
                    </pre>
                  </details>
                  {tab === 'rejected' && a.rejectionReason && (
                    <p className="text-[11px] text-destructive mt-1">Rejected: {a.rejectionReason}</p>
                  )}
                </div>
                {tab === 'pending' && !expired && (
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="success"
                      disabled={isMine || approve.isPending}
                      title={isMine ? 'A second admin must approve' : 'Approve'}
                      onClick={() => {
                        if (!confirm(`Approve "${a.action}"? The action will be marked approved and ready to replay.`)) return;
                        approve.mutate(a.id, {
                          onSuccess: () => toast.success('Approved'),
                          onError: (e) => toast.error(e.message),
                        });
                      }}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost"
                      disabled={reject.isPending}
                      onClick={() => {
                        const reason = prompt('Reason for rejection? (optional)');
                        if (reason === null) return;
                        reject.mutate({ id: a.id, reason: reason || undefined }, {
                          onSuccess: () => toast.success('Rejected'),
                          onError: (e) => toast.error(e.message),
                        });
                      }}>
                      <X className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {!rows?.length && (
            <div className="p-10 text-center text-sm italic text-muted-foreground">
              {tab === 'pending'
                ? <span className="flex items-center justify-center gap-2"><Clock className="h-4 w-4" /> No pending approvals.</span>
                : `No ${tab} approvals.`}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
