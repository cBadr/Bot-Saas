'use client';
import { useAdminAudit } from '@/lib/queries-v2';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/utils';

export default function AdminAuditPage() {
  const { data: logs } = useAdminAudit();
  return (
    <Card><CardContent className="p-0 divide-y max-h-[700px] overflow-y-auto">
      {logs?.map((l) => (
        <div key={l.id} className="p-4 grid grid-cols-12 items-center gap-3 text-sm">
          <Badge variant={l.actorType === 'ADMIN' ? 'warning' : 'secondary'} className="col-span-1 justify-center">{l.actorType}</Badge>
          <code className="col-span-3 text-xs">{l.action}</code>
          <div className="col-span-3 text-xs text-muted-foreground">
            {l.targetType && <>{l.targetType}:{l.targetId?.slice(0, 12)}</>}
          </div>
          <div className="col-span-3 text-xs text-muted-foreground font-mono truncate">
            {l.metadata ? JSON.stringify(l.metadata).slice(0, 80) : ''}
          </div>
          <div className="col-span-2 text-xs text-muted-foreground text-right">{formatRelativeTime(l.createdAt)}</div>
        </div>
      ))}
      {!logs?.length && <div className="p-12 text-center text-muted-foreground">No audit logs.</div>}
    </CardContent></Card>
  );
}
