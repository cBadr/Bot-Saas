'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useMe, useUpdateProfile } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Save } from 'lucide-react';

export default function ProfileSettingsPage() {
  const { data: me } = useMe();
  const update = useUpdateProfile();
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  useEffect(() => {
    if (!me) return;
    setFullName(me.fullName ?? '');
    setAvatarUrl(me.avatarUrl ?? '');
  }, [me]);

  if (!me) return <p className="text-muted-foreground">Loading…</p>;

  const dirty = fullName !== (me.fullName ?? '') || avatarUrl !== (me.avatarUrl ?? '');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Profile</h2>
        <p className="text-sm text-muted-foreground">Your personal details and account status.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
          <CardDescription className="text-xs">Visible to you and inside notifications.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover border" />
            ) : (
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                {(fullName || me.email).charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <Label htmlFor="avatarUrl" className="text-xs">Avatar URL</Label>
              <Input id="avatarUrl" type="url" placeholder="https://…"
                value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="fullName" className="text-xs">Full name</Label>
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Email</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input value={me.email} readOnly className="font-mono" />
              <Badge variant="outline" className="text-[10px]">Verified</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Email changes require 2FA verification — not yet implemented in this UI.
            </p>
          </div>

          <Button
            disabled={!dirty || update.isPending}
            onClick={() => update.mutate(
              { fullName: fullName || undefined, avatarUrl: avatarUrl || undefined },
              { onSuccess: () => toast.success('Profile saved'), onError: (e) => toast.error(e.message) },
            )}>
            <Save className="h-3.5 w-3.5 mr-1" />
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Role" value={<Badge variant="outline" className="font-mono text-[10px]">{me.role}</Badge>} />
          <Row label="Status" value={<Badge variant="outline" className="font-mono text-[10px]">{me.status}</Badge>} />
          <Row label="Member since" value={new Date(me.createdAt).toLocaleDateString()} />
          {me.lastLoginAt && (
            <Row label="Last login" value={new Date(me.lastLoginAt).toLocaleString()} />
          )}
          {me.trialEndsAt && (
            <Row label="Trial ends" value={new Date(me.trialEndsAt).toLocaleDateString()} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b last:border-0 pb-2 last:pb-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
