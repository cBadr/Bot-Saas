'use client';
import { toast } from 'sonner';
import { useNotificationPreferences, useSetNotificationPreference } from '@/lib/queries-v3';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

const EVENTS: { key: string; label: string; desc: string }[] = [
  { key: 'BOT_STARTED', label: 'Bot started', desc: 'When you (or auto-resume) start a bot.' },
  { key: 'BOT_STOPPED', label: 'Bot stopped', desc: 'When a bot is stopped manually or by error.' },
  { key: 'BOT_ERROR', label: 'Bot error', desc: 'When a bot crashes or stops with an error.' },
  { key: 'ORDER_FILLED', label: 'Order filled', desc: 'When a buy/sell order completes.' },
  { key: 'TAKE_PROFIT_HIT', label: 'Take-profit hit', desc: 'When a TP target triggers.' },
  { key: 'STOP_LOSS_HIT', label: 'Stop-loss hit', desc: 'When an SL triggers.' },
  { key: 'PAYMENT_RECEIVED', label: 'Payment received', desc: 'When CoinPayments confirms a payment.' },
  { key: 'SUBSCRIPTION_EXPIRING', label: 'Subscription expiring', desc: 'A few days before expiry.' },
];

const CHANNELS: { key: 'IN_APP' | 'TELEGRAM' | 'EMAIL' | 'DISCORD'; label: string }[] = [
  { key: 'IN_APP', label: 'In-app' },
  { key: 'TELEGRAM', label: 'Telegram' },
  { key: 'EMAIL', label: 'Email' },
  { key: 'DISCORD', label: 'Discord' },
];

export default function NotificationPreferencesPage() {
  const { data: prefs } = useNotificationPreferences();
  const setPref = useSetNotificationPreference();

  const isEnabled = (channel: string, event: string): boolean => {
    const p = prefs?.find((x) => x.channel === channel && x.eventType === event);
    // Default: IN_APP and TELEGRAM enabled, others disabled
    if (!p) return channel === 'IN_APP' || channel === 'TELEGRAM';
    return p.enabled;
  };

  const toggle = (channel: 'IN_APP' | 'TELEGRAM' | 'EMAIL' | 'DISCORD', event: string, current: boolean) => {
    setPref.mutate(
      { channel, eventType: event, enabled: !current },
      {
        onSuccess: () => toast.success('Preference updated'),
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-muted-foreground">Choose how you want to be notified for each event.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Channel preferences</CardTitle>
          <CardDescription>
            Email and Discord channels are coming soon. Telegram requires a chat ID
            in your <Link href="/settings" className="text-primary hover:underline">profile</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left font-medium pb-3 pr-4">Event</th>
                {CHANNELS.map((c) => (
                  <th key={c.key} className="text-center font-medium pb-3 px-2 w-24">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENTS.map((e) => (
                <tr key={e.key} className="border-b last:border-b-0">
                  <td className="py-3 pr-4">
                    <div className="font-medium">{e.label}</div>
                    <div className="text-xs text-muted-foreground">{e.desc}</div>
                  </td>
                  {CHANNELS.map((c) => {
                    const enabled = isEnabled(c.key, e.key);
                    const isComingSoon = c.key === 'EMAIL' || c.key === 'DISCORD';
                    return (
                      <td key={c.key} className="text-center px-2">
                        {isComingSoon ? (
                          <Badge variant="outline" className="text-[9px]">Soon</Badge>
                        ) : (
                          <button
                            disabled={setPref.isPending}
                            onClick={() => toggle(c.key, e.key, enabled)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                              enabled ? 'bg-primary' : 'bg-muted'
                            }`}
                          >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                              enabled ? 'translate-x-5' : 'translate-x-1'
                            }`} />
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
