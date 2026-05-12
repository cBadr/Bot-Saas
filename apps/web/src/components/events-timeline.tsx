'use client';
import { Activity, AlertTriangle, Check, Pause, Play, Repeat, Wrench, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime, formatNumber } from '@/lib/utils';
import type { BotLive } from '@/lib/queries';

/**
 * Typed timeline of recent bot events. Replaces the plain list with icons,
 * coloring per event family, and inline cyclePnl when present. Also shows
 * an engine-heartbeat strip at the top: green if engine touched this bot
 * within 90s, red otherwise.
 */
export function EventsTimeline({ live }: { live: BotLive }) {
  const events = live.events?.recent ?? [];
  const hb = live.heartbeat;
  const ageMs = hb.lastEventAtMs ? Date.now() - hb.lastEventAtMs : null;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Activity Timeline
        </CardTitle>
        <CardDescription className="text-xs flex items-center gap-2">
          {hb.stale ? (
            <span className="flex items-center gap-1 text-destructive">
              <WifiOff className="h-3 w-3" />
              Engine inactive
              {ageMs !== null && <span>({Math.round(ageMs / 1000)}s)</span>}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-success">
              <Wifi className="h-3 w-3" />
              Engine active
              {ageMs !== null && <span>· last touch {Math.round(ageMs / 1000)}s ago</span>}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="max-h-[500px] overflow-y-auto p-0">
        {events.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground italic">No events yet.</p>
        ) : (
          <div>
            {events.map((e) => {
              const meta = classify(e.type);
              return (
                <div key={e.id}
                  className={`flex items-start gap-2 px-4 py-2 border-b last:border-0 hover:bg-muted/30`}>
                  <div className={`mt-0.5 rounded-full p-1 ${meta.bg}`}>
                    <meta.Icon className={`h-3 w-3 ${meta.fg}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[9px] font-mono">{e.type}</Badge>
                      <span className="text-[10px] text-muted-foreground">{formatRelativeTime(e.createdAt)}</span>
                      {e.cyclePnl !== null && e.cyclePnl !== 0 && (
                        <span className={`text-[10px] font-mono font-semibold ${e.cyclePnl > 0 ? 'text-success' : 'text-destructive'}`}>
                          {e.cyclePnl > 0 ? '+' : ''}{formatNumber(e.cyclePnl, { maximumFractionDigits: 4 })}
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5 text-foreground/90 break-words">{e.message}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function classify(type: string): { Icon: typeof Activity; bg: string; fg: string } {
  if (type.includes('FILLED')) return { Icon: Check, bg: 'bg-success/15', fg: 'text-success' };
  if (type.includes('STARTED') || type === 'GRID_PLACEMENT_DONE') return { Icon: Play, bg: 'bg-primary/15', fg: 'text-primary' };
  if (type.includes('STOPPED') || type.includes('COOLDOWN')) return { Icon: Pause, bg: 'bg-muted', fg: 'text-muted-foreground' };
  if (type.includes('INTEGRITY')) return { Icon: Wrench, bg: 'bg-blue-500/15', fg: 'text-blue-500' };
  if (type.includes('ERROR') || type.includes('FAILED') || type.includes('REJECTED')) {
    return { Icon: AlertTriangle, bg: 'bg-destructive/15', fg: 'text-destructive' };
  }
  if (type.includes('RECENTER') || type.includes('CYCLE')) return { Icon: Repeat, bg: 'bg-amber-500/15', fg: 'text-amber-500' };
  return { Icon: Activity, bg: 'bg-muted', fg: 'text-muted-foreground' };
}
