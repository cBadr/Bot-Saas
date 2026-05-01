'use client';
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export type Locale = 'en' | 'ar';

type Dict = Record<string, string>;

const EN: Dict = {
  // Nav
  'nav.signin': 'Sign in',
  'nav.getstarted': 'Get started',
  'nav.pricing': 'Pricing',
  'nav.features': 'Features',
  // Hero
  'hero.badge': 'Zero fees on FDUSD pairs · Limit-only orders · 14-day free trial',
  'hero.title': 'Crypto trading on autopilot',
  'hero.sub': 'Professional grid & DCA bots, real-time TradingView monitoring, multi-channel alerts, and a visual strategy builder — all on Binance Spot.',
  'hero.cta.primary': 'Start free trial',
  'hero.cta.secondary': 'Sign in',
  'hero.trust': 'No credit card required · Cancel anytime',
  // Features
  'features.title': 'Built for serious traders',
  'features.sub': 'Every feature exists because real users asked for it.',
  'features.f1.title': 'x2-style Grid & DCA',
  'features.f1.desc': 'Symmetric ladder grids and DCA with multipliers (flat / percent / dollar). LIMIT_MAKER for zero-fee execution.',
  'features.f2.title': 'Real-time monitoring',
  'features.f2.desc': 'TradingView Lightweight Charts with order overlays, integrity widget, P&L sparkline, cycle counter — all live.',
  'features.f3.title': 'Multi-channel alerts',
  'features.f3.desc': 'Telegram, Email, Discord, Browser Push and in-app inbox. Per-event rules + periodic status digests.',
  'features.f4.title': 'Cycle-based P&L',
  'features.f4.desc': 'Authoritative per-cycle accounting — no more weighted-avg surprises. Realized + Unrealized + Total, always reconciled.',
  'features.f5.title': 'Risk management',
  'features.f5.desc': 'Daily loss limits, max drawdown auto-stop, kill switch, paper trading mode, and AES-256-GCM key encryption.',
  'features.f6.title': 'Visual strategy builder',
  'features.f6.desc': 'Build custom strategies with indicators (SMA, RSI, edge detection) via drag-and-drop nodes. Backtest before going live.',
  // Pricing
  'pricing.title': 'Simple, transparent pricing',
  'pricing.sub': 'Start with a 14-day free trial. No credit card required.',
  'pricing.cta': 'Start free trial',
  'pricing.viewall': 'View all plans',
  // Trust
  'trust.title': 'Trusted by traders running 24/7',
  'trust.sub': 'Battle-tested across thousands of cycles.',
  // Footer
  'footer.privacy': 'Privacy',
  'footer.terms': 'Terms',
  'footer.gdpr': 'GDPR',
  'footer.copy': '© 2026 Orca. All rights reserved.',
  // Trial banner
  'trial.active': 'Free trial — {days} days left',
  'trial.ending': 'Free trial ending soon',
  'trial.expired': 'Your free trial has ended',
  'trial.cta': 'Upgrade',
};

const AR: Dict = {
  'nav.signin': 'تسجيل الدخول',
  'nav.getstarted': 'ابدأ الآن',
  'nav.pricing': 'الأسعار',
  'nav.features': 'المميزات',
  'hero.badge': 'بدون رسوم على أزواج FDUSD · أوامر LIMIT فقط · تجربة مجانية 14 يوم',
  'hero.title': 'تداول العملات الرقمية بالطيار الآلي',
  'hero.sub': 'بوتات Grid و DCA احترافية، مراقبة لحظية بـ TradingView، تنبيهات متعددة القنوات، وأداة بناء استراتيجيات بصرية — على Binance Spot.',
  'hero.cta.primary': 'ابدأ التجربة المجانية',
  'hero.cta.secondary': 'تسجيل الدخول',
  'hero.trust': 'بدون بطاقة ائتمان · إلغاء في أي وقت',
  'features.title': 'مصممة للمتداولين المحترفين',
  'features.sub': 'كل ميزة هنا لأن مستخدماً حقيقياً طلبها.',
  'features.f1.title': 'Grid و DCA بأسلوب x2',
  'features.f1.desc': 'سلالم Grid متماثلة و DCA مع مضاعفات (ثابت / نسبة / دولار). LIMIT_MAKER للتنفيذ بدون رسوم.',
  'features.f2.title': 'مراقبة لحظية',
  'features.f2.desc': 'مخططات TradingView مع طبقات الأوامر، مؤشر السلامة، شريط الربح، عداد الدورات — كل شيء مباشر.',
  'features.f3.title': 'تنبيهات متعددة القنوات',
  'features.f3.desc': 'تيليجرام، إيميل، ديسكورد، إشعارات المتصفح، وصندوق وارد داخلي. قواعد لكل حدث + تقارير دورية.',
  'features.f4.title': 'ربح وخسارة بالدورة',
  'features.f4.desc': 'محاسبة دقيقة لكل دورة — لا مفاجآت من المتوسط المرجح. محقق + عائم + إجمالي، دائماً متطابق.',
  'features.f5.title': 'إدارة المخاطر',
  'features.f5.desc': 'حدود الخسارة اليومية، إيقاف تلقائي عند Drawdown، مفتاح إيقاف، وضع تجريبي، وتشفير AES-256-GCM للمفاتيح.',
  'features.f6.title': 'بناء استراتيجيات بصري',
  'features.f6.desc': 'ابنِ استراتيجيات مخصصة بمؤشرات (SMA, RSI) بالسحب والإفلات. اختبرها قبل التشغيل الفعلي.',
  'pricing.title': 'أسعار بسيطة وشفافة',
  'pricing.sub': 'ابدأ بتجربة مجانية 14 يوم. بدون بطاقة ائتمان.',
  'pricing.cta': 'ابدأ التجربة',
  'pricing.viewall': 'كل الباقات',
  'trust.title': 'موثوق من متداولين يعملون ٢٤/٧',
  'trust.sub': 'مختبر عبر آلاف الدورات.',
  'footer.privacy': 'الخصوصية',
  'footer.terms': 'الشروط',
  'footer.gdpr': 'GDPR',
  'footer.copy': '© 2026 Orca. جميع الحقوق محفوظة.',
  'trial.active': 'تجربة مجانية — {days} يوم متبقي',
  'trial.ending': 'التجربة المجانية تنتهي قريباً',
  'trial.expired': 'انتهت تجربتك المجانية',
  'trial.cta': 'ترقية',
};

const DICTS: Record<Locale, Dict> = { en: EN, ar: AR };

interface I18nCtx {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<I18nCtx | null>(null);

const STORAGE_KEY = 'orca.locale';

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'en' || saved === 'ar') return saved;
  const browser = navigator.language?.toLowerCase() ?? '';
  return browser.startsWith('ar') ? 'ar' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const next = readInitialLocale();
    setLocaleState(next);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      document.cookie = `${STORAGE_KEY}=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = DICTS[locale] ?? EN;
      let s = dict[key] ?? EN[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return s;
    },
    [locale],
  );

  return (
    <Ctx.Provider value={{ locale, dir: locale === 'ar' ? 'rtl' : 'ltr', t, setLocale }}>
      {children}
    </Ctx.Provider>
  );
}

export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}

export function LocaleToggle({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}
      className={`text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded border border-border hover:bg-accent transition-colors ${className}`}
      aria-label="Toggle language"
    >
      {locale === 'en' ? 'AR' : 'EN'}
    </button>
  );
}
