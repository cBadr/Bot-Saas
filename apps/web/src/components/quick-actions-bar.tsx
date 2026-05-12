'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Copy, Download, FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useCloneBot, useCancelPending, useArchiveBot } from '@/lib/queries';
import { api } from '@/lib/api';

/**
 * Compact action toolbar for the bot detail page. Groups operations that
 * are safe enough for one-click but distinct from the primary Start/Stop:
 *   • Clone — copy this bot's config to a new bot
 *   • Cancel Pending — drop only the orders that haven't been placed yet
 *   • Snapshot JSON — full debug dump for hand-off
 *   • Export CSV — all trades for taxes/analytics
 */
export function QuickActionsBar({ botId, botName }: { botId: string; botName: string }) {
  const router = useRouter();
  const clone = useCloneBot();
  const cancel = useCancelPending();
  const archive = useArchiveBot();
  const [loading, setLoading] = useState<string | null>(null);

  async function downloadFile(url: string, filename: string, label: string) {
    setLoading(label);
    try {
      const res = await api.get(url, { responseType: 'blob' });
      const blob = new Blob([res.data]);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success(`${label} downloaded`);
    } catch (e: unknown) {
      toast.error(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={clone.isPending}
        onClick={() => clone.mutate(
          { id: botId, name: `${botName} (copy)` },
          { onSuccess: (b) => toast.success(`Cloned as "${b.name}"`), onError: (e) => toast.error(e.message) },
        )}>
        <Copy className="h-3.5 w-3.5 mr-1" /> Clone
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={cancel.isPending}
        onClick={() => {
          if (!confirm('Cancel ALL pending (not-yet-placed) orders? Open orders are not affected.')) return;
          cancel.mutate(botId, {
            onSuccess: () => toast.success('Cancel requested'),
            onError: (e) => toast.error(e.message),
          });
        }}>
        <Trash2 className="h-3.5 w-3.5 mr-1" /> Cancel Pending
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={loading !== null}
        onClick={() => downloadFile(
          `/bots/${botId}/snapshot`,
          `bot-${botId}-snapshot.json`,
          'Snapshot',
        )}>
        <FileText className="h-3.5 w-3.5 mr-1" />
        {loading === 'Snapshot' ? 'Downloading…' : 'Snapshot JSON'}
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={loading !== null}
        onClick={() => downloadFile(
          `/bots/${botId}/export/trades.csv`,
          `bot-${botId}-trades.csv`,
          'Trades CSV',
        )}>
        <Download className="h-3.5 w-3.5 mr-1" />
        {loading === 'Trades CSV' ? 'Downloading…' : 'Export Trades'}
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={archive.isPending}
        title="Hide this bot from the active list. Data and runs are preserved."
        onClick={() => {
          if (!confirm(`Archive "${botName}"? Bot must be stopped. All trades and runs are preserved.`)) return;
          archive.mutate(botId, {
            onSuccess: () => { toast.success('Bot archived'); router.push('/bots'); },
            onError: (e) => toast.error(e.message),
          });
        }}>
        <Archive className="h-3.5 w-3.5 mr-1" />
        Archive
      </Button>
    </div>
  );
}
