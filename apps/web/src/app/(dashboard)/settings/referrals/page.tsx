'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useReferralStats } from '@/lib/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Share2, Users } from 'lucide-react';

export default function ReferralsPage() {
  const { data: stats } = useReferralStats();
  const [copied, setCopied] = useState(false);

  if (!stats) return null;

  const link = stats.code
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/register?ref=${stats.code}`
    : null;

  function copyLink() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Referrals</h2>
        <p className="text-sm text-muted-foreground">Invite friends and earn rewards (revenue-share program — coming soon).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Share2 className="h-4 w-4" /> Your referral link
          </CardTitle>
          <CardDescription className="text-xs">Share this link to invite new users.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {stats.code ? (
            <>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-muted/40 px-3 py-2 rounded border break-all">{link}</code>
                <Button size="sm" variant="outline" onClick={copyLink}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Your code:</span>
                <Badge variant="outline" className="font-mono">{stats.code}</Badge>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic">No referral code assigned to your account.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Referred users
            <Badge variant="outline" className="text-[10px]">{stats.count}</Badge>
          </CardTitle>
          <CardDescription className="text-xs">People who registered using your link.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recent.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No referrals yet — share your link to start.</p>
          ) : (
            <div className="space-y-1">
              {stats.recent.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs border-b last:border-0 py-1.5">
                  <span className="font-mono">{r.email}</span>
                  <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
              {stats.count > stats.recent.length && (
                <p className="text-[11px] text-muted-foreground italic pt-2">
                  Showing {stats.recent.length} of {stats.count} (most recent).
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
