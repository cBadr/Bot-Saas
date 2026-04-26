'use client';
import { toast } from 'sonner';
import { useAdminSettings, useUpdateSetting } from '@/lib/queries-v2';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';

export default function AdminSettingsPage() {
  const { data: settings } = useAdminSettings();
  const update = useUpdateSetting();
  const [edits, setEdits] = useState<Record<string, string>>({});

  const save = (key: string, isPublic: boolean, category: string | null) => {
    let val: unknown = edits[key];
    try { val = JSON.parse(edits[key]!); } catch { /* keep as string */ }
    update.mutate(
      { key, value: val, isPublic, category: category ?? undefined },
      { onSuccess: () => toast.success('Saved'), onError: (e) => toast.error(e.message) },
    );
  };

  return (
    <Card><CardContent className="p-0 divide-y">
      {settings?.map((s) => (
        <div key={s.key} className="p-4 grid grid-cols-12 gap-3 items-center">
          <div className="col-span-3 font-mono text-sm">{s.key}</div>
          <div className="col-span-2">
            {s.category && <Badge variant="outline" className="text-[10px]">{s.category}</Badge>}
            {s.isPublic && <Badge variant="secondary" className="text-[10px] ml-1">Public</Badge>}
          </div>
          <Input className="col-span-5 font-mono text-xs"
            defaultValue={JSON.stringify(s.value)}
            onChange={(e) => setEdits((p) => ({ ...p, [s.key]: e.target.value }))} />
          <button className="col-span-2 text-xs text-primary hover:underline text-left"
            onClick={() => save(s.key, s.isPublic, s.category)}>
            Save
          </button>
        </div>
      ))}
    </CardContent></Card>
  );
}
