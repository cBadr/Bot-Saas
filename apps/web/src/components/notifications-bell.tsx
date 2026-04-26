'use client';
import { useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { useInbox, useMarkAllRead, useMarkRead, type InboxItem } from '@/lib/queries-v3';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn, formatRelativeTime } from '@/lib/utils';

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const { data } = useInbox();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const unread = data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent transition-colors"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <Badge variant="destructive" className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] text-[10px] px-1 justify-center">
            {unread > 99 ? '99+' : unread}
          </Badge>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-96 max-h-[500px] rounded-lg border bg-card shadow-lg z-20 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-3 border-b">
              <h3 className="font-semibold text-sm">Notifications</h3>
              {unread > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => markAllRead.mutate()}>
                  <Check className="h-3 w-3" />Mark all read
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {!data?.items.length ? (
                <div className="p-12 text-center text-sm text-muted-foreground">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No notifications yet
                </div>
              ) : (
                data.items.map((item) => <Item key={item.id} item={item} onRead={(id) => markRead.mutate(id)} />)
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Item({ item, onRead }: { item: InboxItem; onRead: (id: string) => void }) {
  const isRead = item.error === 'READ';
  return (
    <div
      onClick={() => !isRead && onRead(item.id)}
      className={cn(
        'p-3 border-b last:border-b-0 cursor-pointer hover:bg-accent/50 transition-colors',
        !isRead && 'bg-accent/20',
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <Badge variant="outline" className="text-[9px]">{item.eventType}</Badge>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatRelativeTime(item.createdAt)}</span>
      </div>
      <p className="text-sm">{(item.payload as { message?: string })?.message ?? '(no message)'}</p>
      {!isRead && <div className="h-1.5 w-1.5 rounded-full bg-primary absolute mt-1 right-3" />}
    </div>
  );
}
