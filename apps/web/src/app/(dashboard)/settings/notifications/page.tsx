'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useNotificationPreferences, useSetNotificationPreference } from '@/lib/queries-v3';
import {
  useMe, useUpdateProfile, useTestTelegram, useTestEmail, useTestDiscord,
  useTestPush, useSubscribePush, useUnsubscribePush,
  useSendStatusReportNow, useBots,
  type FillFrequency, type NotificationConfig,
} from '@/lib/queries';
import { isPushSupported, isPushConfigured, subscribeForPush, unsubscribeFromPush } from '@/lib/push';
import { formatDuration } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Send, MessageCircle, Bell, FileText, Clock, Mail, Webhook, BellRing } from 'lucide-react';
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
  { key: 'STATUS_REPORT', label: 'Periodic status report', desc: 'Scheduled comprehensive report (configured above).' },
];

const CHANNELS: { key: 'IN_APP' | 'TELEGRAM' | 'EMAIL' | 'DISCORD' | 'PUSH'; label: string }[] = [
  { key: 'IN_APP', label: 'In-app' },
  { key: 'TELEGRAM', label: 'Telegram' },
  { key: 'EMAIL', label: 'Email' },
  { key: 'DISCORD', label: 'Discord' },
  { key: 'PUSH', label: 'Push' },
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
  const testEmail = useTestEmail();
  const testDiscord = useTestDiscord();
  const testPush = useTestPush();
  const subscribePush = useSubscribePush();
  const unsubscribePush = useUnsubscribePush();
  const [discordUrl, setDiscordUrl] = useState<string>('');
  useEffect(() => {
    if (me?.discordWebhookUrl !== undefined) setDiscordUrl(me.discordWebhookUrl ?? '');
  }, [me?.discordWebhookUrl]);
  const discordSaved = (me?.discordWebhookUrl ?? '') === discordUrl.trim();
  const saveDiscordUrl = () => {
    const trimmed = discordUrl.trim();
    updateProfile.mutate(
      { discordWebhookUrl: trimmed === '' ? null : trimmed },
      {
        onSuccess: () => toast.success(trimmed === '' ? 'Discord cleared' : 'Discord webhook saved'),
        onError: (e) => toast.error(e.message),
      },
    );
  };
  const pushSubs = me?.pushSubscriptions ?? [];
  const pushAvailable = isPushSupported() && isPushConfigured();
  const enablePush = async () => {
    try {
      const sub = await subscribeForPush();
      subscribePush.mutate(sub, {
        onSuccess: () => toast.success('Browser notifications enabled'),
        onError: (e) => toast.error(e.message),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const disablePush = async () => {
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) {
        unsubscribePush.mutate(endpoint, {
          onSuccess: () => toast.success('Browser notifications disabled'),
          onError: (e) => toast.error(e.message),
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

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

  const toggle = (channel: 'IN_APP' | 'TELEGRAM' | 'EMAIL' | 'DISCORD' | 'PUSH', event: string, current: boolean) => {
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

  // ─── Periodic status report state ───
  const { data: bots } = useBots();
  const sendNow = useSendStatusReportNow();
  const intervalCurrent = cfg.statusReportIntervalMinutes ?? 0;
  const reportBotsCurrent = cfg.statusReportBots ?? 'ALL';
  const isAllBots = reportBotsCurrent === 'ALL';
  const selectedBotIds: string[] = isAllBots ? [] : (reportBotsCurrent as string[]);

  const setReportInterval = (minutes: number) => {
    updateProfile.mutate(
      {
        notificationConfig: {
          ...cfg,
          statusReportIntervalMinutes: minutes,
          // Keep existing bot selection.
          statusReportBots: cfg.statusReportBots ?? 'ALL',
        },
      },
      {
        onSuccess: () => toast.success(
          minutes === 0 ? 'Periodic reports disabled' : `Reports every ${minutes}m`,
        ),
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const setReportBots = (next: 'ALL' | string[]) => {
    updateProfile.mutate(
      {
        notificationConfig: {
          ...cfg,
          statusReportBots: next,
        },
      },
      {
        onSuccess: () => toast.success('Bot selection updated'),
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const toggleBotInReport = (botId: string) => {
    const current = isAllBots
      ? (bots ?? []).map((b) => b.id) // expand 'ALL' to explicit list before toggling
      : selectedBotIds;
    const next = current.includes(botId)
      ? current.filter((id) => id !== botId)
      : [...current, botId];
    setReportBots(next);
  };

  const handleSendNow = () => {
    sendNow.mutate(undefined, {
      onSuccess: (r) => {
        if (r.ok) {
          toast.success(`Status report sent (${r.botsIncluded} bot${r.botsIncluded === 1 ? '' : 's'})`);
        } else {
          toast.error(r.reason ?? 'Could not send report');
        }
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const lastSentLabel = me?.lastStatusReportAt
    ? formatDuration(me.lastStatusReportAt) + ' ago'
    : 'never';

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

      {/* ─── Email (Resend) ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            Email
          </CardTitle>
          <CardDescription>
            Sent to <code className="text-foreground">{me?.email}</code> via the configured Resend
            account on the server. Enable the EMAIL channel below for the events you care about.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => testEmail.mutate(undefined, {
              onSuccess: () => toast.success('Test email sent — check your inbox!'),
              onError: (e) => toast.error(e.message),
            })}
            disabled={testEmail.isPending}
          >
            <Send className="h-4 w-4" />
            {testEmail.isPending ? 'Sending…' : 'Send test email'}
          </Button>
        </CardContent>
      </Card>

      {/* ─── Discord webhook ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Webhook className="h-4 w-4 text-primary" />
            Discord webhook
          </CardTitle>
          <CardDescription>
            In your Discord server: Channel settings → Integrations → Webhooks → New Webhook → Copy
            URL. Paste it below to receive Orca alerts as embedded messages.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor="discordUrl">Webhook URL</Label>
            <div className="flex gap-2">
              <Input
                id="discordUrl"
                type="url"
                placeholder="https://discord.com/api/webhooks/..."
                value={discordUrl}
                onChange={(e) => setDiscordUrl(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                onClick={saveDiscordUrl}
                disabled={updateProfile.isPending || discordSaved}
                variant={discordSaved ? 'outline' : 'default'}
              >
                {discordSaved ? 'Saved' : 'Save'}
              </Button>
              <Button
                onClick={() => testDiscord.mutate(undefined, {
                  onSuccess: () => toast.success('Test sent to Discord!'),
                  onError: (e) => toast.error(e.message),
                })}
                variant="outline"
                disabled={testDiscord.isPending || !me?.discordWebhookUrl || !discordSaved}
              >
                <Send className="h-4 w-4" />
                Test
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Browser push ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            Browser push
          </CardTitle>
          <CardDescription>
            {!isPushSupported()
              ? 'Your browser does not support web push notifications.'
              : !isPushConfigured()
                ? 'Web push is not configured on the server (NEXT_PUBLIC_VAPID_PUBLIC_KEY missing).'
                : 'Enable to receive push notifications even when the tab is closed (PWA-style).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              onClick={enablePush}
              disabled={!pushAvailable || subscribePush.isPending}
            >
              {subscribePush.isPending ? 'Enabling…' : 'Enable on this device'}
            </Button>
            <Button
              variant="outline"
              onClick={disablePush}
              disabled={!pushAvailable || unsubscribePush.isPending || pushSubs.length === 0}
            >
              Disable on this device
            </Button>
            <Button
              variant="outline"
              onClick={() => testPush.mutate(undefined, {
                onSuccess: (r) => toast.success(`Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}`),
                onError: (e) => toast.error(e.message),
              })}
              disabled={testPush.isPending || pushSubs.length === 0}
            >
              <Send className="h-4 w-4" />
              Test
            </Button>
          </div>
          {pushSubs.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {pushSubs.length} device{pushSubs.length === 1 ? '' : 's'} subscribed.
            </p>
          )}
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

      {/* ─── Periodic status reports ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Periodic status reports
          </CardTitle>
          <CardDescription>
            Receive a comprehensive Telegram digest of your bots&apos; status on a schedule.
            Includes profits, cycle counts, and ladder shape for each selected bot.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Interval picker */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Send every</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { v: 0, label: 'Off' },
                { v: 15, label: '15m' },
                { v: 30, label: '30m' },
                { v: 60, label: '1h' },
                { v: 240, label: '4h' },
                { v: 1440, label: '24h' },
              ].map(({ v, label }) => {
                const active = intervalCurrent === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setReportInterval(v)}
                    disabled={updateProfile.isPending}
                    className={`px-3 py-1.5 rounded-md border text-xs font-mono transition-colors ${
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-primary/40 hover:bg-accent/40'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {intervalCurrent > 0 && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                Last sent: <span className="font-mono">{lastSentLabel}</span>
              </p>
            )}
          </div>

          {/* Bot selector */}
          {intervalCurrent > 0 && (
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Bots to include
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReportBots('ALL')}
                  className={`text-left rounded-md border p-3 transition-colors ${
                    isAllBots
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                      : 'border-border hover:border-primary/40 hover:bg-accent/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">All my bots</span>
                    {isAllBots && <Badge variant="default" className="text-[9px]">Active</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Auto-includes any bot you create later. {(bots?.length ?? 0)} bot{(bots?.length ?? 0) === 1 ? '' : 's'} currently.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setReportBots(selectedBotIds.length ? selectedBotIds : (bots ?? []).map((b) => b.id))}
                  className={`text-left rounded-md border p-3 transition-colors ${
                    !isAllBots
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                      : 'border-border hover:border-primary/40 hover:bg-accent/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">Custom selection</span>
                    {!isAllBots && (
                      <Badge variant="default" className="text-[9px]">
                        {selectedBotIds.length} selected
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Pick which bots appear in the report.
                  </div>
                </button>
              </div>

              {/* Per-bot toggles when in Custom mode */}
              {!isAllBots && (
                <div className="rounded-md border bg-muted/20 p-2 max-h-64 overflow-y-auto space-y-1">
                  {(bots ?? []).length === 0 ? (
                    <div className="text-xs text-muted-foreground italic px-2 py-3 text-center">
                      You don&apos;t have any bots yet.
                    </div>
                  ) : (
                    (bots ?? []).map((b) => {
                      const checked = selectedBotIds.includes(b.id);
                      return (
                        <label
                          key={b.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/40 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBotInReport(b.id)}
                            className="rounded border-input"
                          />
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{b.name}</span>
                            <Badge variant="outline" className="font-mono text-[9px]">{b.symbol}</Badge>
                            <Badge variant="secondary" className="text-[9px]">{b.status}</Badge>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {/* Send-now preview button */}
          <div className="flex items-center gap-2 pt-2 border-t">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSendNow}
              disabled={sendNow.isPending || (bots?.length ?? 0) === 0}
            >
              <Send className="h-3.5 w-3.5" />
              {sendNow.isPending ? 'Sending…' : 'Send report now'}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Preview the report with your current selection.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ─── Advanced delivery rules ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery rules</CardTitle>
          <CardDescription>
            Mute specific bots, batch notifications into digests, set quiet hours, and filter by severity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Per-bot mute */}
          <div>
            <Label className="text-xs uppercase tracking-wide">Muted bots</Label>
            <p className="text-[11px] text-muted-foreground mb-2">No notifications from these bots (any channel, any event).</p>
            {(bots?.length ?? 0) === 0 ? (
              <p className="text-xs italic text-muted-foreground">No bots yet.</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2 max-h-[180px] overflow-y-auto rounded-md border p-2">
                {bots!.map((b) => {
                  const muted = (cfg.mutedBotIds ?? []).includes(b.id);
                  return (
                    <label key={b.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/30 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={muted}
                        onChange={(e) => {
                          const ids = new Set(cfg.mutedBotIds ?? []);
                          if (e.target.checked) ids.add(b.id); else ids.delete(b.id);
                          updateProfile.mutate(
                            { notificationConfig: { ...cfg, mutedBotIds: [...ids] } },
                            { onError: (er) => toast.error(er.message) },
                          );
                        }}
                      />
                      <span className="truncate">{b.name}</span>
                      <Badge variant="outline" className="text-[9px] font-mono ml-auto">{b.symbol}</Badge>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Digest mode */}
          <div>
            <Label htmlFor="digest" className="text-xs uppercase tracking-wide">Digest interval</Label>
            <p className="text-[11px] text-muted-foreground mb-1">
              Batch fill notifications and send them periodically instead of one-by-one. 0 = send immediately.
            </p>
            <select
              id="digest"
              className="h-9 px-2 rounded-md border bg-background text-sm"
              value={cfg.digestIntervalMinutes ?? 0}
              onChange={(e) => updateProfile.mutate(
                { notificationConfig: { ...cfg, digestIntervalMinutes: Number(e.target.value) } },
                { onSuccess: () => toast.success('Digest updated'), onError: (er) => toast.error(er.message) },
              )}>
              <option value="0">Off (immediate)</option>
              <option value="5">Every 5 minutes</option>
              <option value="15">Every 15 minutes</option>
              <option value="60">Every hour</option>
              <option value="240">Every 4 hours</option>
              <option value="1440">Daily</option>
            </select>
            <p className="text-[10px] text-muted-foreground italic mt-1">
              Critical events (bot errors, payment failures) bypass digest.
            </p>
          </div>

          {/* Quiet hours */}
          <div>
            <Label className="text-xs uppercase tracking-wide">Quiet hours</Label>
            <p className="text-[11px] text-muted-foreground mb-1">
              Suppress non-critical notifications during these hours.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="time"
                value={cfg.quietHours?.start ?? ''}
                onChange={(e) => updateProfile.mutate(
                  { notificationConfig: { ...cfg, quietHours: { start: e.target.value, end: cfg.quietHours?.end ?? '07:00', tz: cfg.quietHours?.tz } } },
                  { onError: (er) => toast.error(er.message) },
                )}
                className="h-9 px-2 rounded-md border bg-background text-sm font-mono"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="time"
                value={cfg.quietHours?.end ?? ''}
                onChange={(e) => updateProfile.mutate(
                  { notificationConfig: { ...cfg, quietHours: { start: cfg.quietHours?.start ?? '23:00', end: e.target.value, tz: cfg.quietHours?.tz } } },
                  { onError: (er) => toast.error(er.message) },
                )}
                className="h-9 px-2 rounded-md border bg-background text-sm font-mono"
              />
              {cfg.quietHours && (
                <Button size="sm" variant="ghost"
                  onClick={() => updateProfile.mutate(
                    { notificationConfig: { ...cfg, quietHours: null } },
                    { onSuccess: () => toast.success('Quiet hours cleared') },
                  )}>
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Severity filter */}
          <div>
            <Label htmlFor="severity" className="text-xs uppercase tracking-wide">Severity filter</Label>
            <p className="text-[11px] text-muted-foreground mb-1">
              Receive only events at or above a chosen severity.
            </p>
            <select
              id="severity"
              className="h-9 px-2 rounded-md border bg-background text-sm"
              value={cfg.severityFilter ?? 'ALL'}
              onChange={(e) => updateProfile.mutate(
                { notificationConfig: { ...cfg, severityFilter: e.target.value as 'ALL' | 'WARN_AND_ABOVE' | 'CRITICAL_ONLY' } },
                { onSuccess: () => toast.success('Filter updated'), onError: (er) => toast.error(er.message) },
              )}>
              <option value="ALL">All events</option>
              <option value="WARN_AND_ABOVE">Warnings and critical only</option>
              <option value="CRITICAL_ONLY">Critical only (errors, payment failures)</option>
            </select>
          </div>

          <p className="text-[10px] text-muted-foreground italic border-t pt-2">
            Note: Digest, quiet hours, and severity gates are stored in your profile; engine-side enforcement is rolling out — verify with a test message after changes.
          </p>
        </CardContent>
      </Card>

      {/* ─── Channel preferences grid ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-event channels</CardTitle>
          <CardDescription>
            Choose which channels receive each event type. Connect Telegram / Email / Discord / Push above first.
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
                    return (
                      <td key={c.key} className="text-center px-2">
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
