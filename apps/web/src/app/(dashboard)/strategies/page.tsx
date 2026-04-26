'use client';
import Link from 'next/link';
import { useStrategies } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, Workflow } from 'lucide-react';

export default function StrategiesPage() {
  const { data: strategies, isLoading } = useStrategies();

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Strategies</h1>
          <p className="text-muted-foreground">Built-in and custom trading strategies.</p>
        </div>
        <Button asChild><Link href="/strategies/builder"><Sparkles className="h-4 w-4" />Open Builder</Link></Button>
      </div>

      {isLoading ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {strategies?.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-5 w-5 text-primary" />
                    <CardTitle>{s.name}</CardTitle>
                  </div>
                  <Badge variant={s.visibility === 'BUILTIN' ? 'default' : 'outline'}>{s.visibility}</Badge>
                </div>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{s.type}</Badge>
                  {s.builtinKey && <span className="font-mono">{s.builtinKey}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <Workflow className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground mb-2">Visual Strategy Builder</p>
          <p className="text-xs text-muted-foreground">Coming in Phase 5 — drag &amp; drop node-based strategy editor.</p>
        </CardContent>
      </Card>
    </div>
  );
}
