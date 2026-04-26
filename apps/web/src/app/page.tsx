'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ArrowRight, Bot, Shield, Sparkles, Zap } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    if (tokenStore.access) router.replace('/dashboard');
  }, [router]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-background to-accent/30">
      <nav className="container flex items-center justify-between py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
            🐋
          </div>
          <span className="text-xl font-bold">Orca</span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild><Link href="/login">Sign in</Link></Button>
          <Button asChild><Link href="/register">Get started</Link></Button>
        </div>
      </nav>

      <section className="container py-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-sm text-muted-foreground mb-8">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Zero fees on FDUSD pairs · Limit orders only
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">
          Crypto trading on autopilot
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Professional grid bots, multi-exchange API key management, and a visual strategy builder — all on Binance.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Button size="lg" asChild>
            <Link href="/register">Start trading <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </section>

      <section className="container grid md:grid-cols-3 gap-6 pb-24">
        {[
          { icon: Bot, title: 'Built-in Strategies', desc: 'Grid trading with arithmetic & geometric spacing, TP/SL, trailing-up.' },
          { icon: Zap, title: 'Live Time Sync', desc: 'Continuous Binance time sync for precision order execution.' },
          { icon: Shield, title: 'Bot Isolation', desc: 'Each bot runs in isolation — failures never affect other strategies.' },
        ].map((f) => (
          <div key={f.title} className="rounded-xl border bg-card p-6">
            <f.icon className="h-8 w-8 text-primary mb-4" />
            <h3 className="font-semibold mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
