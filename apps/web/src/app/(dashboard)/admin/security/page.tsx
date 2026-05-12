'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSecuritySettings, useSetSecuritySettings } from '@/lib/queries-v2';
import { useMe } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Save, ShieldCheck, ShieldOff, Globe2, AlertTriangle } from 'lucide-react';

export default function AdminSecurityPage() {
  const { data: me } = useMe();
  const { data: settings } = useSecuritySettings();
  const save = useSetSecuritySettings();
  const [mfa, setMfa] = useState(false);
  const [ipsText, setIpsText] = useState('');

  useEffect(() => {
    if (!settings) return;
    setMfa(settings.requireMfaForAdmin);
    setIpsText(settings.ipAllowlist.join('\n'));
  }, [settings]);

  function submit() {
    const ips = ipsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    save.mutate({ requireMfaForAdmin: mfa, ipAllowlist: ips }, {
      onSuccess: () => toast.success('Security settings saved'),
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Gates that apply to all admin (ADMIN / SUPER_ADMIN) requests.</p>

      {/* Self-protection warning */}
      {me && me.role === 'ADMIN' && me.twoFactorEnabled === false && mfa && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
          <div>
            <strong>You don't have 2FA enabled.</strong> Saving this will lock <em>you</em> out of admin routes.
            Enable 2FA in Settings → Security first, or do it after as SUPER_ADMIN.
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            {mfa ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldOff className="h-4 w-4" />}
            Require 2FA for admin access
          </CardTitle>
          <CardDescription className="text-xs">
            When ON, any admin without an enabled authenticator is blocked from <code className="font-mono">/admin/*</code> endpoints.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={mfa} onChange={(e) => setMfa(e.target.checked)} />
            Require 2FA for all admin users
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe2 className="h-4 w-4" /> IP Allowlist
            {settings && settings.ipAllowlist.length > 0 && (
              <Badge variant="success" className="text-[10px]">{settings.ipAllowlist.length} active</Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            One entry per line. Accepts literal IPv4 (<code className="font-mono">203.0.113.4</code>) or CIDR (<code className="font-mono">203.0.113.0/24</code>). Empty = no restriction.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="ips" className="text-xs">Allowed IPs</Label>
          <textarea id="ips"
            value={ipsText} onChange={(e) => setIpsText(e.target.value)}
            placeholder={"203.0.113.4\n10.0.0.0/8"}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono min-h-[140px]" />
          <p className="text-[10px] text-muted-foreground">
            Tip: Add your current IP first before enabling the list — otherwise you'll lock yourself out.
            If you do, fix the <code>ADMIN_IP_ALLOWLIST</code> row directly in the <code>app_settings</code> table.
          </p>
        </CardContent>
      </Card>

      <Button onClick={submit} disabled={save.isPending}>
        <Save className="h-3.5 w-3.5 mr-1" />
        {save.isPending ? 'Saving…' : 'Save security settings'}
      </Button>
    </div>
  );
}
