'use client';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { ReactNode } from 'react';

export function LegalLayout({ title, lastUpdated, children }: { title: string; lastUpdated: string; children: ReactNode }) {
  const { dir } = useI18n();
  return (
    <main dir={dir} className="min-h-screen bg-background">
      <nav className="container flex items-center justify-between py-6 border-b">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">🐋</div>
          <span className="text-xl font-bold">Orca</span>
        </Link>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          Home
        </Link>
      </nav>
      <article className="container max-w-3xl py-12 prose prose-invert prose-headings:scroll-mt-24 dark:prose-invert">
        <h1 className="text-4xl font-bold mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {lastUpdated}</p>
        <div className="space-y-6 text-[15px] leading-relaxed text-foreground/90 [&>h2]:text-2xl [&>h2]:font-bold [&>h2]:mt-10 [&>h2]:mb-3 [&>h3]:text-lg [&>h3]:font-semibold [&>h3]:mt-6 [&>h3]:mb-2 [&_ul]:list-disc [&_ul]:ms-6 [&_ul]:space-y-1 [&_a]:text-primary [&_a]:underline">
          {children}
        </div>
      </article>
    </main>
  );
}
