'use client';
import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api, apiCall } from '@/lib/api';
import { cn } from '@/lib/utils';

type NodeKind = 'trigger.price' | 'trigger.rsi' | 'trigger.cross' | 'action.buy' | 'action.sell' | 'logic.and' | 'logic.or' | 'logic.not';

interface NodeData {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  config: Record<string, string | number>;
}
interface Edge { from: string; to: string }

const NODE_PALETTE: { kind: NodeKind; label: string; category: string; defaults: Record<string, string | number> }[] = [
  { kind: 'trigger.price', label: 'Price Crosses', category: 'Trigger', defaults: { direction: 'above', price: 0 } },
  { kind: 'trigger.rsi', label: 'RSI', category: 'Trigger', defaults: { period: 14, condition: '<', value: 30 } },
  { kind: 'trigger.cross', label: 'MA Cross', category: 'Trigger', defaults: { fast: 9, slow: 21, direction: 'up' } },
  { kind: 'logic.and', label: 'AND', category: 'Logic', defaults: {} },
  { kind: 'logic.or', label: 'OR', category: 'Logic', defaults: {} },
  { kind: 'logic.not', label: 'NOT', category: 'Logic', defaults: {} },
  { kind: 'action.buy', label: 'BUY', category: 'Action', defaults: { quoteAmount: 100 } },
  { kind: 'action.sell', label: 'SELL', category: 'Action', defaults: { percent: 100 } },
];

export default function StrategyBuilderPage() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [name, setName] = useState('My Custom Strategy');

  const addNode = (kind: NodeKind) => {
    const tpl = NODE_PALETTE.find((n) => n.kind === kind)!;
    setNodes((ns) => [...ns, {
      id: `n${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind, x: 80 + ns.length * 30, y: 80 + ns.length * 30,
      config: { ...tpl.defaults },
    }]);
  };
  const removeNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    setSelected(null);
  };
  const updateConfig = (id: string, key: string, val: string | number) => {
    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, config: { ...n.config, [key]: val } } : n));
  };

  const onDrag = useCallback((id: string, e: React.MouseEvent) => {
    const start = { mx: e.clientX, my: e.clientY };
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const orig = { x: node.x, y: node.y };
    const move = (ev: MouseEvent) => {
      setNodes((ns) => ns.map((n) => n.id === id ? { ...n, x: orig.x + (ev.clientX - start.mx), y: orig.y + (ev.clientY - start.my) } : n));
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [nodes]);

  const onSocketClick = (id: string, kind: 'out' | 'in') => {
    if (kind === 'out') setConnecting(id);
    else if (connecting && connecting !== id) {
      setEdges((es) => [...es.filter((e) => !(e.from === connecting && e.to === id)), { from: connecting, to: id }]);
      setConnecting(null);
    }
  };

  const save = async (): Promise<{ id: string } | null> => {
    if (nodes.length === 0) {
      toast.error('Add at least one node to save.');
      return null;
    }
    try {
      const r = await apiCall<{ id: string }>(() => api.post('/strategies', {
        name,
        description: 'Built with Visual Strategy Builder',
        definition: { engine: 'graph_v1', nodes, edges },
        paramsSchema: { type: 'object', properties: {} },
      }));
      toast.success('Strategy saved!');
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
      return null;
    }
  };

  const router = useRouter();
  const launch = async () => {
    const r = await save();
    if (r?.id) router.push(`/bots/new?strategyId=${r.id}`);
  };

  const sel = nodes.find((n) => n.id === selected);

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Strategy Builder</h1>
          <p className="text-muted-foreground">Design custom strategies visually with triggers, logic, and actions.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input className="w-64" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="outline" onClick={save}><Save className="h-4 w-4" />Save</Button>
          <Button onClick={launch}><Play className="h-4 w-4" />Save &amp; Launch Bot</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Palette */}
        <Card className="col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Nodes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(['Trigger', 'Logic', 'Action'] as const).map((cat) => (
              <div key={cat}>
                <p className="text-xs text-muted-foreground uppercase mb-1">{cat}</p>
                <div className="space-y-1">
                  {NODE_PALETTE.filter((n) => n.category === cat).map((n) => (
                    <Button key={n.kind} variant="outline" size="sm" className="w-full justify-start text-xs h-8"
                      onClick={() => addNode(n.kind)}>
                      <Plus className="h-3 w-3" />{n.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Canvas */}
        <Card className="col-span-7 h-[600px] overflow-hidden relative">
          <div ref={canvasRef} className="relative w-full h-full bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] [background-size:20px_20px]"
            onClick={() => { setSelected(null); setConnecting(null); }}>
            <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
              {edges.map((e, i) => {
                const fromN = nodes.find((n) => n.id === e.from);
                const toN = nodes.find((n) => n.id === e.to);
                if (!fromN || !toN) return null;
                return (
                  <line key={i} x1={fromN.x + 160} y1={fromN.y + 40} x2={toN.x} y2={toN.y + 40}
                    stroke="hsl(var(--primary))" strokeWidth={2} markerEnd="url(#arrow)" />
                );
              })}
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--primary))" />
                </marker>
              </defs>
            </svg>
            {nodes.map((n) => (
              <div key={n.id}
                onClick={(e) => { e.stopPropagation(); setSelected(n.id); }}
                onMouseDown={(e) => { if ((e.target as HTMLElement).dataset.drag === '1') onDrag(n.id, e); }}
                className={cn(
                  'absolute w-40 rounded-lg border bg-card p-2 shadow text-xs select-none',
                  selected === n.id && 'ring-2 ring-primary',
                )}
                style={{ left: n.x, top: n.y }}>
                <div data-drag="1" className="cursor-grab active:cursor-grabbing flex items-center justify-between mb-1">
                  <Badge variant="outline" className="text-[9px]">{n.kind.split('.')[0]}</Badge>
                  <span className="font-medium">{NODE_PALETTE.find((p) => p.kind === n.kind)?.label}</span>
                </div>
                <div className="text-muted-foreground text-[10px] font-mono truncate">
                  {Object.entries(n.config).map(([k, v]) => `${k}:${v}`).join(' · ')}
                </div>
                {/* Sockets */}
                <button className="absolute left-[-6px] top-9 w-3 h-3 rounded-full bg-secondary border border-primary"
                  onClick={(e) => { e.stopPropagation(); onSocketClick(n.id, 'in'); }} />
                <button className={cn(
                    'absolute right-[-6px] top-9 w-3 h-3 rounded-full border border-primary',
                    connecting === n.id ? 'bg-primary' : 'bg-secondary',
                  )}
                  onClick={(e) => { e.stopPropagation(); onSocketClick(n.id, 'out'); }} />
              </div>
            ))}
            {!nodes.length && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                Click nodes from the left panel to add them.
              </div>
            )}
          </div>
        </Card>

        {/* Inspector */}
        <Card className="col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Inspector</CardTitle>
            <CardDescription className="text-xs">Selected node properties.</CardDescription>
          </CardHeader>
          <CardContent>
            {!sel ? (
              <p className="text-xs text-muted-foreground">Select a node to edit its properties.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{NODE_PALETTE.find((p) => p.kind === sel.kind)?.label}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeNode(sel.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {Object.entries(sel.config).map(([k, v]) => (
                  <div key={k}>
                    <Label className="text-xs">{k}</Label>
                    <Input
                      value={v}
                      onChange={(e) => updateConfig(sel.id, k, isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))}
                      className="h-8 mt-1"
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        💡 Click a node&apos;s right socket then another node&apos;s left socket to connect. Drag nodes by their header. Custom-graph execution lands in Phase 5.5.
      </p>
    </div>
  );
}
