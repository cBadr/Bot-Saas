import { Badge } from '@/components/ui/badge';

export function StatusBadge({ status }: { status: string }) {
  const variant: 'default' | 'success' | 'destructive' | 'warning' | 'secondary' =
    status === 'RUNNING' ? 'success' :
    status === 'ERROR' ? 'destructive' :
    status === 'STARTING' || status === 'STOPPING' ? 'warning' :
    'secondary';
  return <Badge variant={variant}>{status}</Badge>;
}
