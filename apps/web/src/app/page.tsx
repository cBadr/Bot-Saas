'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  ArrowRight, Bot, Shield, Sparkles, Zap, BarChart3, BellRing, Layers, CheckCircle2,
} from 'lucide-react';
import { useI18n, LocaleToggle } from '@/lib/i18n';

const FEATURE_ICONS = [Layers, BarChart3, BellRing, Zap, Shield, Bot] as const;

export default function HomePage() {
  const router = useRouter();
  const { t, dir } = useI18n();

  useEffect(() => {
    if (tokenStore.access) router.replace('/dashboard');
  }, [router]);

  return (
    <main dir={dir} className="min-h-screen bg-gradient-to-br from-background via-background to-accent/30">
      {/* ─── Nav ─── */}
      <nav className="container flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
            🐋
          </div>
          <span className="text-xl font-bold">Orca</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="#features" className="hidden sm:block text-sm text-muted-foreground hover:text-foreground px-3">
            {t('nav.features')}
          </Link>
          <Link href="/pricing" className="hidden sm:block text-sm text-muted-foreground hover:text-foreground px-3">
            {t('nav.pricing')}
          </Link>
          <LocaleToggle />
          <Button variant="ghost" asChild><Link href="/login">{t('nav.signin')}</Link></Button>
          <Button asChild><Link href="/register">{t('nav.getstarted')}</Link></Button>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="container py-20 md:py-28 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-xs sm:text-sm text-muted-foreground mb-8">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {t('hero.badge')}
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">
          {t('hero.title')}
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          {t('hero.sub')}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
          <Button size="lg" asChild>
            <Link href="/register">
              {t('hero.cta.primary')} <ArrowRight className="ms-1 h-4 w-4 rtl:rotate-180" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">{t('hero.cta.secondary')}</Link>
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">{t('hero.trust')}</p>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="container py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold mb-3">{t('features.title')}</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">{t('features.sub')}</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((n, i) => {
            const Icon = FEATURE_ICONS[i];
            return (
              <div key={n} className="rounded-xl border bg-card p-6 hover:border-primary/40 transition-colors">
                <Icon className="h-8 w-8 text-primary mb-4" />
                <h3 className="font-semibold mb-2 text-lg">{t(`features.f${n}.title`)}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t(`features.f${n}.desc`)}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Trust strip ─── */}
      <section className="container py-16 border-y">
        <div className="grid sm:grid-cols-3 gap-8 text-center">
          <div>
            <div className="text-3xl font-bold mb-1">~50ms</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Fill latency</div>
          </div>
          <div>
            <div className="text-3xl font-bold mb-1">0%</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Fees on FDUSD pairs</div>
          </div>
          <div>
            <div className="text-3xl font-bold mb-1">5</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Notification channels</div>
          </div>
        </div>
      </section>

      {/* ─── Pricing teaser ─── */}
      <section className="container py-20 text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-3">{t('pricing.title')}</h2>
        <p className="text-muted-foreground mb-8">{t('pricing.sub')}</p>
        <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto mb-10">
          {[
            { name: 'Starter', price: '$0', desc: 'Trial — 14 days, 1 bot' },
            { name: 'Pro', price: '$29', desc: '10 bots, all channels', highlight: true },
            { name: 'Trader', price: '$99', desc: 'Unlimited bots, marketplace' },
          ].map((p) => (
            <div
              key={p.name}
              className={`rounded-xl border bg-card p-6 ${p.highlight ? 'ring-2 ring-primary' : ''}`}
            >
              <div className="text-sm text-muted-foreground mb-1">{p.name}</div>
              <div className="text-3xl font-bold mb-1">{p.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
              <div className="text-xs text-muted-foreground">{p.desc}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button size="lg" asChild>
            <Link href="/register"><CheckCircle2 className="me-2 h-4 w-4" />{t('pricing.cta')}</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/pricing">{t('pricing.viewall')}</Link>
          </Button>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t mt-20">
        <div className="container py-10 flex flex-col sm:flex-row gap-4 items-center justify-between text-sm text-muted-foreground">
          <div>{t('footer.copy')}</div>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-foreground">{t('footer.privacy')}</Link>
            <Link href="/terms" className="hover:text-foreground">{t('footer.terms')}</Link>
            <Link href="/gdpr" className="hover:text-foreground">{t('footer.gdpr')}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
