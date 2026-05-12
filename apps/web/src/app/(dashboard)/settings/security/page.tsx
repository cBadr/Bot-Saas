'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  useMe, useChangePassword, useSetup2FA, useVerify2FA, useDisable2FA,
  useSessions, useRevokeSession, useRevokeAllSessions,
  useAuditLog,
} from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Smartphone, ShieldCheck, ShieldOff, LogOut, Lock, KeyRound, History } from 'lucide-react';

export default function SecuritySettingsPage() {
  const { data: me } = useMe();
  const { data: sessions } = useSessions();
  const { data: audit } = useAuditLog();
  const changePw = useChangePassword();
  const setup2FA = useSetup2FA();
  const verify2FA = useVerify2FA();
  const disable2FA = useDisable2FA();
  const revokeSession = useRevokeSession();
  const revokeAll = useRevokeAllSessions();

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const pwScore = scorePassword(newPw);

  const [setupSecret, setSetupSecret] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [disableCode, setDisableCode] = useState('');

  if (!me) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Security</h2>
        <p className="text-sm text-muted-foreground">Password, two-factor auth, devices, and audit history.</p>
      </div>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" /> Password</CardTitle>
          <CardDescription className="text-xs">Choose a strong password and store it in a password manager.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="cur" className="text-xs">Current password</Label>
            <Input id="cur" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new" className="text-xs">New password</Label>
            <Input id="new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            {newPw && (
              <div className="mt-1 space-y-1">
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full transition-all ${strengthColor(pwScore)}`} style={{ width: `${pwScore * 25}%` }} />
                </div>
                <p className="text-[10px] text-muted-foreground">{strengthLabel(pwScore)}</p>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="cnf" className="text-xs">Confirm new password</Label>
            <Input id="cnf" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            {confirmPw && newPw !== confirmPw && (
              <p className="text-[10px] text-destructive mt-1">Passwords don't match.</p>
            )}
          </div>
          <Button
            disabled={changePw.isPending || !currentPw || !newPw || newPw !== confirmPw || pwScore < 2}
            onClick={() => changePw.mutate(
              { currentPassword: currentPw, newPassword: newPw },
              {
                onSuccess: () => { toast.success('Password changed'); setCurrentPw(''); setNewPw(''); setConfirmPw(''); },
                onError: (e) => toast.error(e.message),
              },
            )}>
            <KeyRound className="h-3.5 w-3.5 mr-1" />
            {changePw.isPending ? 'Updating…' : 'Update password'}
          </Button>
        </CardContent>
      </Card>

      {/* 2FA */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Two-factor authentication
            {me.twoFactorEnabled
              ? <Badge variant="success" className="text-[10px]">Enabled</Badge>
              : <Badge variant="outline" className="text-[10px]">Disabled</Badge>}
          </CardTitle>
          <CardDescription className="text-xs">
            Requires a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!me.twoFactorEnabled ? (
            <>
              {!setupSecret ? (
                <Button
                  variant="outline"
                  disabled={setup2FA.isPending}
                  onClick={() => setup2FA.mutate(undefined, {
                    onSuccess: (data) => setSetupSecret(data),
                    onError: (e) => toast.error(e.message),
                  })}>
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                  {setup2FA.isPending ? 'Generating…' : 'Set up 2FA'}
                </Button>
              ) : (
                <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                  <div>
                    <p className="text-xs font-semibold">1. Scan in your authenticator app:</p>
                    <code className="block mt-1 text-[10px] break-all bg-background p-2 rounded border font-mono">
                      {setupSecret.otpauthUrl}
                    </code>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Or enter the secret manually: <code className="font-mono">{setupSecret.secret}</code>
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="code" className="text-xs">2. Enter the 6-digit code:</Label>
                    <div className="flex gap-2 mt-1">
                      <Input id="code" inputMode="numeric" maxLength={6}
                        value={setupCode} onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, ''))}
                        className="font-mono text-center text-lg tracking-widest" />
                      <Button
                        disabled={verify2FA.isPending || setupCode.length !== 6}
                        onClick={() => verify2FA.mutate(setupCode, {
                          onSuccess: () => { toast.success('2FA enabled'); setSetupSecret(null); setSetupCode(''); },
                          onError: (e) => toast.error(e.message),
                        })}>
                        Verify
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground italic">
                Note: Recovery codes are not yet implemented. Keep your authenticator app backed up.
              </p>
            </>
          ) : (
            <div className="flex gap-2">
              <Input inputMode="numeric" maxLength={6} placeholder="Enter 6-digit code to disable"
                value={disableCode} onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
                className="font-mono" />
              <Button
                variant="destructive"
                disabled={disable2FA.isPending || disableCode.length !== 6}
                onClick={() => disable2FA.mutate(disableCode, {
                  onSuccess: () => { toast.success('2FA disabled'); setDisableCode(''); },
                  onError: (e) => toast.error(e.message),
                })}>
                <ShieldOff className="h-3.5 w-3.5 mr-1" />
                Disable
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <LogOut className="h-4 w-4" /> Active sessions
            <Badge variant="outline" className="text-[10px]">{sessions?.length ?? 0}</Badge>
          </CardTitle>
          <CardDescription className="text-xs">Devices currently signed in to your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {!sessions?.length ? (
            <p className="text-xs text-muted-foreground italic">No active sessions found.</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between border rounded-md p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{s.userAgent ?? 'Unknown device'}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {s.ipAddress ?? '—'} · created {new Date(s.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="sm"
                    disabled={revokeSession.isPending}
                    onClick={() => revokeSession.mutate(s.id, {
                      onSuccess: () => toast.success('Session revoked'),
                      onError: (e) => toast.error(e.message),
                    })}>
                    Revoke
                  </Button>
                </div>
              ))}
              <Button
                variant="outline" size="sm"
                disabled={revokeAll.isPending}
                onClick={() => {
                  if (!confirm('Sign out of ALL devices? You\'ll be logged out everywhere.')) return;
                  revokeAll.mutate(undefined, {
                    onSuccess: (r) => toast.success(`Revoked ${r.revoked} session(s)`),
                    onError: (e) => toast.error(e.message),
                  });
                }}>
                Sign out everywhere
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> Recent activity
            <Badge variant="outline" className="text-[10px]">{audit?.length ?? 0}</Badge>
          </CardTitle>
          <CardDescription className="text-xs">Last 200 security-relevant events on your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {!audit?.length ? (
            <p className="text-xs text-muted-foreground italic">No audit entries yet.</p>
          ) : (
            <div className="max-h-[400px] overflow-y-auto space-y-1.5">
              {audit.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-2 border-b last:border-0 pb-1.5 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[9px] font-mono">{e.action}</Badge>
                      {e.targetType && <span className="text-[10px] text-muted-foreground">{e.targetType}</span>}
                    </div>
                    {e.ipAddress && (
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {e.ipAddress}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function scorePassword(pw: string): number {
  if (pw.length < 8) return 0;
  let score = 0;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}
function strengthLabel(s: number): string {
  return ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][s] ?? 'Strong';
}
function strengthColor(s: number): string {
  return ['bg-destructive', 'bg-destructive', 'bg-amber-500', 'bg-amber-500', 'bg-success'][s] ?? 'bg-success';
}
