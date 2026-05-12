'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useMe, useDeleteAccount } from '@/lib/queries';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';

export default function DangerZonePage() {
  const { data: me } = useMe();
  const router = useRouter();
  const deleteAcc = useDeleteAccount();
  const [confirmEmail, setConfirmEmail] = useState('');
  const [exporting, setExporting] = useState(false);

  if (!me) return null;
  const canDelete = confirmEmail.trim().toLowerCase() === me.email.toLowerCase();

  async function downloadExport() {
    setExporting(true);
    try {
      const res = await api.get('/users/me/export');
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `orca-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('Data exported');
    } catch (e: unknown) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  async function confirmDelete() {
    if (!canDelete) return;
    if (!confirm('This is irreversible. ALL your data (bots, trades, events, API keys) will be permanently deleted. Continue?')) return;
    deleteAcc.mutate(confirmEmail, {
      onSuccess: () => {
        toast.success('Account deleted');
        // Clear local tokens and redirect to landing.
        if (typeof window !== 'undefined') {
          window.localStorage.clear();
          window.location.href = '/';
        }
      },
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" /> Danger Zone
        </h2>
        <p className="text-sm text-muted-foreground">Irreversible operations. Read carefully before acting.</p>
      </div>

      {/* GDPR export */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4" /> Export my data (GDPR)
          </CardTitle>
          <CardDescription className="text-xs">
            Download a JSON file containing your profile, bots, sessions, audit log, and a sample of your trades and events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={downloadExport} disabled={exporting}>
            <Download className="h-3.5 w-3.5 mr-1" />
            {exporting ? 'Preparing…' : 'Download my data'}
          </Button>
          <p className="text-[10px] text-muted-foreground mt-2 italic">
            For full trade history, use the per-bot CSV export from the bot detail page.
          </p>
        </CardContent>
      </Card>

      {/* Account deletion */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" /> Delete account
          </CardTitle>
          <CardDescription className="text-xs">
            Permanently deletes your account and every record tied to it. <strong className="text-destructive">This cannot be undone.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1">
            <p>The following will be removed:</p>
            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
              <li>All bots and their trading history</li>
              <li>All API keys (you can revoke them on the exchange too)</li>
              <li>Audit log, sessions, notifications, push subscriptions</li>
              <li>Referral relationships</li>
            </ul>
            <p className="pt-1">You must <strong>stop all running bots</strong> before deletion.</p>
          </div>

          <div>
            <Label htmlFor="confirmEmail" className="text-xs">
              Type your email <code className="font-mono text-destructive">{me.email}</code> to confirm:
            </Label>
            <Input
              id="confirmEmail"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={me.email}
              className="font-mono"
            />
          </div>

          <Button
            variant="destructive"
            disabled={!canDelete || deleteAcc.isPending}
            onClick={confirmDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {deleteAcc.isPending ? 'Deleting…' : 'Permanently delete my account'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
