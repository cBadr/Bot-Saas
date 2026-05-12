import type { ReactNode } from 'react';
import { SettingsNav } from '@/components/settings-nav';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr] max-w-6xl">
      <aside className="lg:border-r lg:pr-4">
        <h1 className="text-2xl font-bold mb-4 hidden lg:block">Settings</h1>
        <SettingsNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
