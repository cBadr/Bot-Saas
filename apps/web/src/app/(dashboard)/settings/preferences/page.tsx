'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useMe, useUpdateProfile, type UserPreferences } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Save } from 'lucide-react';

const TIMEZONES = [
  'UTC', 'Europe/London', 'Europe/Paris', 'Europe/Istanbul',
  'Asia/Dubai', 'Asia/Riyadh', 'Asia/Tehran', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo',
  'Asia/Shanghai', 'Australia/Sydney',
  'America/Sao_Paulo', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Anchorage',
  'Pacific/Auckland',
];

const QUOTES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'BTC', 'ETH'];

export default function PreferencesPage() {
  const { data: me } = useMe();
  const update = useUpdateProfile();
  const { setLocale: setLocaleClient } = useI18n();
  const [prefs, setPrefs] = useState<UserPreferences>({});

  useEffect(() => {
    if (!me) return;
    const cfg = (me.notificationConfig as { preferences?: UserPreferences } | null | undefined) ?? {};
    setPrefs(cfg.preferences ?? {});
  }, [me]);

  if (!me) return null;
  const browserTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

  function set<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setPrefs((p) => ({ ...p, [key]: value }));
  }

  async function save() {
    if (!me) return;
    const cfg = (me.notificationConfig as Record<string, unknown> | null) ?? {};
    update.mutate(
      { notificationConfig: { ...cfg, preferences: prefs } },
      {
        onSuccess: () => {
          toast.success('Preferences saved');
          // Apply theme + locale immediately on the client.
          applyTheme(prefs.theme ?? 'system');
          applyDensity(prefs.density ?? 'comfortable');
          if (prefs.locale) setLocaleClient(prefs.locale);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Preferences</h2>
        <p className="text-sm text-muted-foreground">Personalize how the app looks and what units it uses.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription className="text-xs">Theme and content density.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Theme">
            <Segment
              value={prefs.theme ?? 'system'}
              options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]}
              onChange={(v) => set('theme', v as UserPreferences['theme'])}
            />
          </Field>
          <Field label="Density">
            <Segment
              value={prefs.density ?? 'comfortable'}
              options={[['compact', 'Compact'], ['comfortable', 'Comfortable']]}
              onChange={(v) => set('density', v as UserPreferences['density'])}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Localization</CardTitle>
          <CardDescription className="text-xs">Language, timezone, and date format.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Language">
            <Segment
              value={prefs.locale ?? 'en'}
              options={[['en', 'English'], ['ar', 'العربية']]}
              onChange={(v) => set('locale', v as UserPreferences['locale'])}
            />
          </Field>
          <Field label="Date format">
            <Segment
              value={prefs.dateFormat ?? 'DMY'}
              options={[['DMY', 'DD/MM/YYYY'], ['MDY', 'MM/DD/YYYY'], ['YMD', 'YYYY-MM-DD']]}
              onChange={(v) => set('dateFormat', v as UserPreferences['dateFormat'])}
            />
          </Field>
          <Field label="Timezone">
            <select
              className="w-full h-9 px-2 rounded-md border bg-background text-sm"
              value={prefs.timezone ?? browserTz}
              onChange={(e) => set('timezone', e.target.value)}>
              {!TIMEZONES.includes(browserTz) && <option value={browserTz}>{browserTz} (browser)</option>}
              {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">
              Browser detected: <code className="font-mono">{browserTz}</code>
            </p>
          </Field>
          <Field label="Default quote currency">
            <select
              className="w-full h-9 px-2 rounded-md border bg-background text-sm"
              value={prefs.defaultQuote ?? 'FDUSD'}
              onChange={(e) => set('defaultQuote', e.target.value)}>
              {QUOTES.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </Field>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={update.isPending}>
        <Save className="h-3.5 w-3.5 mr-1" />
        {update.isPending ? 'Saving…' : 'Save preferences'}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Segment<T extends string>({ value, options, onChange }: {
  value: T;
  options: ReadonlyArray<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border bg-background p-0.5">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            value === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
          }`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function applyTheme(t: 'light' | 'dark' | 'system') {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (t === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.classList.toggle('dark', prefersDark);
  } else {
    html.classList.toggle('dark', t === 'dark');
  }
}

function applyDensity(d: 'compact' | 'comfortable') {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = d;
}
