'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokenStore } from '@/lib/api';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { TrialBanner } from '@/components/trial-banner';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!tokenStore.access) router.replace('/login');
    else setOk(true);
  }, [router]);

  if (!ok) return null;
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Topbar />
        <TrialBanner />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
