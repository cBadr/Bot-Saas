'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { X, Star } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSubmitSurvey } from '@/lib/queries-v2';
import { useMe } from '@/lib/queries';

const DISMISS_KEY = 'orca_nps_dismissed_at';
const COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;   // 90 days
const MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // need 7 days as user before asking

/**
 * NPS prompt at the bottom-right corner. Shown to users at most every 90 days
 * once their account is ≥ 7 days old. Locally dismissed via localStorage.
 */
export function NpsWidget() {
  const { data: me } = useMe();
  const submit = useSubmitSurvey();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!me) return;
    const created = me.createdAt ? new Date(me.createdAt).getTime() : null;
    if (!created || Date.now() - created < MIN_ACCOUNT_AGE_MS) return;
    const dismissedAt = typeof window !== 'undefined' ? Number(localStorage.getItem(DISMISS_KEY) ?? 0) : 0;
    if (Date.now() - dismissedAt < COOLDOWN_MS) return;
    setVisible(true);
  }, [me]);

  function dismiss() {
    setVisible(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
  }

  function send() {
    if (score === null) return;
    submit.mutate({ surveyKey: 'nps', score, comment: comment.trim() || undefined }, {
      onSuccess: () => { toast.success('Thanks for the feedback!'); dismiss(); },
      onError: (e) => toast.error(e.message),
    });
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)]">
      <Card className="shadow-xl border-primary/40">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="font-semibold text-sm">How likely are you to recommend Orca to a friend?</h4>
              <p className="text-[10px] text-muted-foreground">0 = not at all · 10 = extremely likely</p>
            </div>
            <button onClick={dismiss} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-1 justify-between">
            {Array.from({ length: 11 }, (_, i) => i).map((n) => {
              const sel = score === n;
              const tone = n <= 6 ? 'text-destructive border-destructive/40'
                : n <= 8 ? 'text-amber-500 border-amber-500/40'
                : 'text-success border-success/40';
              return (
                <button
                  key={n}
                  onClick={() => setScore(n)}
                  className={`w-7 h-7 rounded text-xs font-mono border transition-all ${
                    sel ? `${tone} bg-primary/10 scale-110` : 'border-muted hover:border-foreground/40'
                  }`}>
                  {n}
                </button>
              );
            })}
          </div>
          {score !== null && (
            <>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)}
                placeholder={score >= 9 ? 'What do you love most? (optional)'
                  : score <= 6 ? 'What can we improve? (optional)'
                  : 'Anything else? (optional)'}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-xs min-h-[60px]"
                maxLength={1000} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={dismiss}>Skip</Button>
                <Button size="sm" onClick={send} disabled={submit.isPending}>
                  <Star className="h-3 w-3 mr-1" />
                  {submit.isPending ? 'Sending…' : 'Submit'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
