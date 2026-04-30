'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useNotificationPreferences, useSetNotificationPreference } from '@/lib/queries-v3';
import { useMe, useUpdateProfile, useTestTelegram, type FillFrequency, type NotificationConfig } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Send, MessageCircle, Bell } from 'lucide-react';
import Link from 'next/link';

const EVENTS: { key: string; label: string; desc: string }[] = [
  { key: 'BOT_STARTED', label: 'Bot started', desc: 'When you (or auto-resume) start a bot.' },
  { key: 'BOT_STOPPED', label: 'Bot stopped', desc: 'When a bot is stopped manually or by error.' },
  { key: 'BOT_ERROR', label: 'Bot error', desc: 'Fatal API error, daily-loss / drawdown limit, or stuck bot.' },
  { key: 'CYCLE_COMPLETED', label: 'Cycle completed', desc: 'When a full BUY↔SELL cycle closes (with realized PnL).' },
  { key: 'ORDER_FILLED', label: 'Order filled', desc: 'Individual order fills. Frequency controlled by the selector below.' },
  { key: 'TAKE_PROFIT_HIT', label: 'Take-profit hit', desc: 'When a TP target triggers.' },
  { key: 'STOP_LOSS_HIT', label: 'Stop-loss hit', desc: 'When an SL or daily-loss limit triggers.' },
  { key: 'PAYMENT_RECEIVED', label: 'Payment received', desc: 'When CoinPayments confirms a payment.' },
  { key: 'SUBSCRIPTION_EXPIRING', label: 'Subscription expiring', desc: 'A few days before expiry.' },
];

const CHANNELS: { key: 'IN_APP' | 'TELEGRAM' | 'EMAIL' | 'DISCORD'; label: string }[] = [
  { key: 'IN_APP', label: 'In-app' },
  { key: 'TELEGRAM', label: 'Telegram' },
  { key: 'EMAIL', label: 'Email' },
  { key: 'DISCORD', label: 'Discord' },
];

const FREQUENCY_OPTIONS: { key: FillFrequency; label: string; desc: string }[] = [
  { key: 'OFF', label: 'Off', desc: 'Never notify on individual fills.' },
  { key: 'PER_CYCLE', label: 'Per cycle', desc: 'Only on full BUY↔SELL cycle close (default).' },
  { key: 'PER_FILL', label: 'Every fill', desc: 'Every ladder rung fill. Verbose — may produce many messages.' },
  { key: 'CUSTOM', label: 'Custom', desc: 'Set your own rules — side filter + minimum thresholds.' },
];

export default function NotificationPreferencesPage() {
  const { data: me } = useMe();
  const { data: prefs } = useNotificationPreferences();
  const setPref = useSetNotificationPreference();
  const updateProfile = useUpdateProfile();
  const testTelegram = useTestTelegram();

  // Local edit buffer for chat ID so user can edit without instant save spam
  const [chatId, setChatId] = useState<string>('');
  useEffect(() => {
    if (me?.telegramChatId !== undefined) setChatId(me.telegramChatId ?? '');
  }, [me?.telegramChatId]);

  const isEnabled = (channel: string, event: string): boolean => {
    const p = prefs?.find((x) => x.channel === channel && x.eventType === event);
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

  const saveChatId = () => {
    const trimmed = chatId.trim();
    updateProfile.mutate(
      { telegramChatId: trimmed === '' ? null : trimmed },
      {
        onSuccess: () => toast.success(trimmed === '' ? 'Chat ID cleared' : 'Chat ID saved'),
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const sendTest = () => {
    testTelegram.mutate(undefined, {
      onSuccess: () => toast.success('Test sent — check your Telegram!'),
      onError: (e) => toast.error(e.message),
    });
  };

  const setFrequency = (freq: FillFrequency) => {
    updateProfile.mutate(
      { fillFrequency: freq },
      {
        onSuccess: () => toast.success('Frequency updated'),
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const currentFrequency: FillFrequency = me?.fillFrequency ?? 'PER_CYCLE';
  const chatIdSaved = (me?.telegramChatId ?? '') === chatId.trim();
  const cfg: NotificationConfig = me?.notificationConfig ?? {};

  // Local edit buffer for custom config — debounce-saved on blur or via "Apply"
  const [draftCfg, setDraftCfg] = useState<NotificationConfig>(cfg);
  useEffect(() => {
    setDraftCfg(me?.notificationConfig ?? {});
  }, [me?.notificationConfig]);

  const cfgDirty = JSON.stringify(draftCfg) !== JSON.stringify(me?.notificationConfig ?? {});
  const saveCustomConfig = () => {
    updateProfile.mutate(
      { notificationConfig: draftCfg },
      {
        onSuccess: () => toast.success('Custom rules saved'),
        onError: (e) => toast.error(e.message),
      },
    );
  };
  const updateDraft = (patch: Partial<NotificationConfig>) =>
    setDraftCfg((prev) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-muted-foreground">
            Configure your Telegram bot, choose which events to receive, and how often.
          </p>
        </div>
      </div>

      {/* ─── Telegram setup ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            Telegram setup
          </CardTitle>
          <CardDescription>
            Open Telegram, message <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-primary hover:underline">@userinfobot</a> to
            get your numeric chat ID, then paste it below. Don&apos;t forget to start a chat
            with the Orca bot first so it can DM you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor="chatId">Telegram chat ID</Label>
            <div className="flex gap-2">
              <Input
                id="chatId"
                placeholder="e.g. 123456789"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                className="font-mono"
              />
              <Button
                onClick={saveChatId}
                disabled={updateProfile.isPending || chatIdSaved}
                variant={chatIdSaved ? 'outline' : 'default'}
              >
                {chatIdSaved ? 'Saved' : 'Save'}
              </Button>
              <Button
                onClick={sendTest}
                disabled={testTelegram.isPending || !me?.telegramChatId || !chatIdSaved}
                variant="outline"
                title={
                  !me?.telegramChatId
                    ? 'Save a chat ID first'
                    : !chatIdSaved
                      ? 'Save your changes before testing'
                      : 'Send a test message'
                }
              >
                <Send className="h-4 w-4" />
                {testTelegram.isPending ? 'Sending…' : 'Test'}
              </Button>
            </div>
            {me?.telegramChatId && (
              <p className="text-[11px] text-muted-foreground">
                Currently sending to chat ID:{' '}
                <code className="text-foreground">{me.telegramChatId}</code>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Fill frequency ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            Fill notification frequency
          </CardTitle>
          <CardDescription>
            Controls how often you receive <code>ORDER_FILLED</code> messages.
            <code> CYCLE_COMPLETED</code> always fires once per closed cycle, regardless.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {FREQUENCY_OPTIONS.map((opt) => {
              const active = currentFrequency === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setFrequency(opt.key)}
                  disabled={updateProfile.isPending}
                  className={`text-left rounded-md border p-3 transition-colors ${
                    active
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                      : 'border-border hover:border-primary/40 hover:bg-accent/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">{opt.label}</span>
                    {active && <Badge variant="default" className="text-[9px]">Active</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </button>
              );
            })}
          </div>

          {/* ─── Custom rules panel — only when CUSTOM is selected ─── */}
          {currentFrequency === 'CUSTOM' && (
            <div className="rounded-md border-2 border-primary/30 bg-primary/5 p-4 space-y-4">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                Custom rules
                {cfgDirty && (
                  <Badge variant="outline" className="text-[9px] border-yellow-500/50 text-yellow-700 dark:text-yellow-400">
                    unsaved
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground -mt-2">
                Filter which fills produce notifications. Cycle closes always notify
                unless their PnL is below the threshold below.
              </p>

              {/* Side filters */}
              <div className="grid sm:grid-cols-2 gap-3">
                <ToggleRow
                  label="Notify on BUY fills"
                  desc="Opening BUY-side fills (DCA-BUY ladder, Grid below market)."
                  enabled={draftCfg.notifyOnBuyFills !== false}
                  onChange={(v) => updateDraft({ notifyOnBuyFills: v })}
                />
                <ToggleRow
                  label="Notify on SELL fills"
                  desc="Opening SELL-side fills (DCA-SELL ladder, Grid above market)."
                  enabled={draftCfg.notifyOnSellFills !== false}
                  onChange={(v) => updateDraft({ notifyOnSellFills: v })}
                />
              </div>

              {/* Thresholds */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Min fill notional ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="0 = no minimum"
                    value={draftCfg.minFillNotional ?? ''}
                    onChange={(e) => updateDraft({
                      minFillNotional: e.target.value === '' ? undefined : Number(e.target.value),
                    })}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Skip fills whose quote value (price × qty) is below this.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Min cycle PnL ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="0 = notify on all closes"
                    value={draftCfg.minCyclePnl ?? ''}
                    onChange={(e) => updateDraft({
                      minCyclePnl: e.target.value === '' ? undefined : Number(e.target.value),
                    })}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Suppress cycle close messages whose absolute PnL is below this.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t">
                <Button
                  size="sm"
                  onClick={saveCustomConfig}
                  disabled={!cfgDirty || updateProfile.isPending}
                >
                  Apply rules
                </Button>
                {cfgDirty && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraftCfg(me?.notificationConfig ?? {})}
                  >
                    Discard
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Channel preferences grid ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-event channels</CardTitle>
          <CardDescription>
            Choose which channels receive each event type. Email and Discord coming soon.
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

function ToggleRow({
  label, desc, enabled, onChange,
}: {
  label: string;
  desc: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="flex items-start justify-between gap-3 rounded-md border bg-background p-3 text-left hover:border-primary/40 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
      </div>
      <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors mt-0.5 ${
        enabled ? 'bg-primary' : 'bg-muted'
      }`}>
        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-1'
        }`} />
      </span>
    </button>
  );
}
