'use client';
import { useSurveys, useNpsSummary } from '@/lib/queries-v2';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Smile, Meh, Frown, MessageSquare } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

export default function AdminSurveysPage() {
  const { data: nps } = useNpsSummary(90);
  const { data: responses } = useSurveys();

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">User survey responses + Net Promoter Score (last 90 days).</p>

      {/* NPS summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">NPS · last {nps?.days ?? 90} days</CardTitle>
          <CardDescription className="text-xs">
            Promoters (9-10) − Detractors (0-6) as a percentage of total respondents.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <NpsCard label="NPS Score"
            value={nps?.nps !== null && nps?.nps !== undefined ? String(nps.nps) : '—'}
            tone={nps?.nps == null ? undefined : nps.nps >= 50 ? 'positive' : nps.nps >= 0 ? 'neutral' : 'negative'}
            big />
          <NpsCard label="Promoters" value={String(nps?.promoters ?? 0)}
            icon={<Smile className="h-4 w-4 text-success" />} tone="positive" />
          <NpsCard label="Passives" value={String(nps?.passives ?? 0)}
            icon={<Meh className="h-4 w-4 text-amber-500" />} />
          <NpsCard label="Detractors" value={String(nps?.detractors ?? 0)}
            icon={<Frown className="h-4 w-4 text-destructive" />} tone="negative" />
        </CardContent>
      </Card>

      {/* Distribution bar */}
      {nps && nps.total > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1.5">Distribution ({nps.total} responses)</div>
            <div className="flex h-6 rounded-md overflow-hidden">
              <div className="bg-destructive" style={{ width: `${(nps.detractors / nps.total) * 100}%` }}
                title={`Detractors: ${nps.detractors}`} />
              <div className="bg-amber-500" style={{ width: `${(nps.passives / nps.total) * 100}%` }}
                title={`Passives: ${nps.passives}`} />
              <div className="bg-success" style={{ width: `${(nps.promoters / nps.total) * 100}%` }}
                title={`Promoters: ${nps.promoters}`} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Responses */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Recent responses
            <Badge variant="outline" className="text-[10px]">{responses?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 max-h-[500px] overflow-y-auto">
          {!responses?.length ? (
            <p className="p-3 text-xs italic text-muted-foreground">No responses yet.</p>
          ) : (
            responses.map((r) => (
              <div key={r.id} className="px-3 py-2 border-b last:border-0 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[9px] font-mono">{r.surveyKey}</Badge>
                  {r.score !== null && (
                    <Badge
                      variant={r.category === 'promoter' ? 'success' : r.category === 'detractor' ? 'destructive' : 'outline'}
                      className="text-[9px]">
                      {r.score}/10 · {r.category ?? '—'}
                    </Badge>
                  )}
                  {r.user && <span className="font-mono text-[10px] text-muted-foreground">{r.user.email}</span>}
                  <span className="ml-auto text-[10px] text-muted-foreground">{formatRelativeTime(r.createdAt)}</span>
                </div>
                {r.comment && <p className="mt-1 text-xs">{r.comment}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NpsCard({ label, value, icon, tone, big }: {
  label: string; value: string; icon?: React.ReactNode;
  tone?: 'positive' | 'negative' | 'neutral'; big?: boolean;
}) {
  const cls = tone === 'positive' ? 'text-success'
    : tone === 'negative' ? 'text-destructive'
    : tone === 'neutral' ? 'text-amber-500' : '';
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`font-bold tabular-nums mt-1 ${cls} ${big ? 'text-3xl' : 'text-xl'}`}>{value}</div>
    </div>
  );
}
