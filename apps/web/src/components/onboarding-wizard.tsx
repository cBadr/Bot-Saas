'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, Check, Key, Sparkles, X } from 'lucide-react';
import { useExchangeKeys, useBots, useMe } from '@/lib/queries';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DISMISSED_KEY = 'orca_onboarding_dismissed';

interface Step {
  title: string;
  desc: string;
  done: boolean;
  href: string;
  ctaLabel: string;
  icon: typeof Sparkles;
}

export function OnboardingWizard() {
  const { data: me } = useMe();
  const { data: keys } = useExchangeKeys();
  const { data: bots } = useBots();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === 'true');
    }
  }, []);

  if (!me || dismissed) return null;

  const steps: Step[] = [
    {
      title: 'Add a Binance API key',
      desc: 'Connect your Binance Spot account to enable live trading.',
      done: (keys?.length ?? 0) > 0,
      href: '/exchange-keys',
      ctaLabel: 'Add API key',
      icon: Key,
    },
    {
      title: 'Create your first bot',
      desc: 'Use the built-in Grid strategy or build your own.',
      done: (bots?.length ?? 0) > 0,
      href: '/bots/new',
      ctaLabel: 'Create bot',
      icon: Bot,
    },
    {
      title: 'Try the Strategy Builder',
      desc: 'Design custom node-based strategies visually.',
      done: false, // optional
      href: '/strategies/builder',
      ctaLabel: 'Open builder',
      icon: Sparkles,
    },
  ];

  const allDone = steps.slice(0, 2).every((s) => s.done);
  if (allDone) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setDismissed(true);
  };

  const completed = steps.filter((s) => s.done).length;

  return (
    <Card className="relative border-primary/30 bg-gradient-to-br from-primary/5 to-accent/30 overflow-hidden">
      <button onClick={dismiss} className="absolute top-3 right-3 p-1 rounded hover:bg-accent" title="Dismiss">
        <X className="h-4 w-4 text-muted-foreground" />
      </button>
      <div className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">Welcome to Orca!</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Complete these steps to start automating your trading. {completed}/{steps.length} done.
        </p>
        <div className="space-y-2">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={i} className={cn(
                'flex items-center gap-3 p-3 rounded-lg border bg-card/60',
                step.done && 'opacity-60',
              )}>
                <div className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  step.done ? 'bg-success/20 text-success' : 'bg-primary/20 text-primary',
                )}>
                  {step.done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{step.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{step.desc}</div>
                </div>
                {!step.done && (
                  <Button size="sm" asChild>
                    <Link href={step.href}>{step.ctaLabel}</Link>
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
