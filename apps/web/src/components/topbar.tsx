'use client';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { LogOut, Moon, Sun } from 'lucide-react';
import { useMe } from '@/lib/queries';
import { tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ConnectionStatus } from '@/components/connection-status';
import { NotificationsBell } from '@/components/notifications-bell';
import { MobileSidebar } from '@/components/mobile-sidebar';
import { useEffect, useState } from 'react';

export function Topbar() {
  const { theme, setTheme } = useTheme();
  const { data: me } = useMe();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const logout = () => {
    tokenStore.clear();
    router.push('/login');
  };

  return (
    <header className="border-b bg-card/30 backdrop-blur sticky top-0 z-10">
      <div className="flex h-14 items-center justify-between px-4 md:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileSidebar />
          <div className="text-sm text-muted-foreground truncate">
            {me ? <>Welcome, <span className="font-medium text-foreground">{me.fullName ?? me.email}</span></> : ''}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ConnectionStatus />
          <NotificationsBell />
          <div className="h-5 w-px bg-border mx-1" />
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {mounted && theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={logout} title="Logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
