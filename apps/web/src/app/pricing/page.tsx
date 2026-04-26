'use client';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { usePlans } from '@/lib/queries-v2';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function PricingPage() {
  const { data: plans } = usePlans();
  return (
    <main className="min-h-screen bg-gradient-to-br from-background to-accent/30">
      <nav className="container flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">🐋</div>
          <span className="text-xl font-bold">Orca</span>
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild><Link href="/login">Sign in</Link></Button>
          <Button asChild><Link href="/register">Get started</Link></Button>
        </div>
      </nav>
      <section className="container pb-24">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Simple, transparent pricing</h1>
          <p className="text-lg text-muted-foreground">Pay in crypto via CoinPayments. Cancel anytime.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 max-w-7xl mx-auto">
          {plans?.map((p) => {
            const isFree = Number(p.priceUsd) === 0;
            return (
              <Card key={p.id} className={p.code === 'pro' ? 'border-primary shadow-lg shadow-primary/20' : ''}>
                <CardHeader>
                  {p.code === 'pro' && <div className="text-xs font-semibold text-primary uppercase mb-1">Most popular</div>}
                  <CardTitle>{p.name}</CardTitle>
                  <CardDescription>{p.description}</CardDescription>
                  <div className="pt-3">
                    <span className="text-4xl font-bold">${Number(p.priceUsd).toFixed(0)}</span>
                    {!isFree && <span className="text-muted-foreground">/month</span>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2 text-sm">
                    <Item>{p.maxBots} active bots</Item>
                    <Item>{p.maxApiKeys} API keys</Item>
                    <Item>{p.maxCustomStrategies > 0 ? `${p.maxCustomStrategies} custom strategies` : 'Built-in strategies only'}</Item>
                    <Item>Telegram notifications</Item>
                    <Item>Real-time dashboard</Item>
                  </ul>
                  <Button className="w-full" asChild variant={p.code === 'pro' ? 'default' : 'outline'}>
                    <Link href={`/billing?plan=${p.id}`}>{isFree ? 'Get started free' : 'Subscribe'}</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2"><Check className="h-4 w-4 text-success mt-0.5 shrink-0" /><span>{children}</span></li>;
}
