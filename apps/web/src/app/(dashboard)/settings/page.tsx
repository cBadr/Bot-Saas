'use client';
import Link from 'next/link';
import { Bell, ChevronRight } from 'lucide-react';
import { useMe } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export default function SettingsPage() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Account preferences and notifications.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Email" value={me.email} />
          <Field label="Full name" value={me.fullName ?? '—'} />
          <Field label="Role" value={me.role} />
          <Field label="Referral code" value={me.referralCode ?? '—'} />
          <Field label="2FA" value={me.twoFactorEnabled ? 'Enabled' : 'Disabled'} />
          <Field label="Telegram" value={me.telegramChatId ? `Connected (${me.telegramChatId})` : 'Not connected'} />
        </CardContent>
      </Card>

      <Link href="/settings/notifications">
        <Card className="hover:bg-accent/30 transition-colors cursor-pointer">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-primary" />
              <div>
                <div className="font-medium">Notification preferences</div>
                <div className="text-xs text-muted-foreground">Choose channels per event type</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
