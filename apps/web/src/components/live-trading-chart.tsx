'use client';
import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineStyle,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type CandlestickData,
  type Time,
} from 'lightweight-charts';
import { TrendingUp, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { BotLive } from '@/lib/queries';

const INTERVAL = '5m';
const KLINE_LIMIT = 200;

interface KlineMsg {
  e: string;
  k: { t: number; o: string; h: string; l: string; c: string; x: boolean };
}

/**
 * Live trading chart powered by TradingView's Lightweight Charts v5.
 *
 *   - Candlesticks fetched from Binance REST (last 200 × 5m bars)
 *   - Live updates via Binance WebSocket kline stream
 *   - Each bot order rendered as a horizontal price line:
 *       open BUY  → solid green
 *       open SELL → solid red
 *       failed    → dashed yellow ("pending repair")
 *   - Anchor (initialStartPrice) shown as a dashed primary line
 *   - Smooth tween animations for live candle updates
 */
export function LiveTradingChart({ live }: { live: BotLive }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const [ready, setReady] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  // ─── Init chart once ───
  useEffect(() => {
    if (!containerRef.current) return;
    const isDark = typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark');

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: isDark ? '#a1a1aa' : '#52525b',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isDark ? '#27272a' : '#e4e4e7' },
        horzLines: { color: isDark ? '#27272a' : '#e4e4e7' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: isDark ? '#52525b' : '#a1a1aa', style: LineStyle.Dashed, width: 1 },
        horzLine: { color: isDark ? '#52525b' : '#a1a1aa', style: LineStyle.Dashed, width: 1 },
      },
      rightPriceScale: {
        borderColor: isDark ? '#3f3f46' : '#d4d4d8',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: isDark ? '#3f3f46' : '#d4d4d8',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#16a34a',
      borderDownColor: '#dc2626',
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      wsRef.current?.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current.clear();
    };
  }, []);

  // ─── Load historical klines + start WS feed ───
  useEffect(() => {
    if (!seriesRef.current || !live.symbol) return;
    let cancelled = false;
    const symbol = live.symbol.toUpperCase();

    (async () => {
      try {
        const res = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=${KLINE_LIMIT}`,
        );
        const raw = (await res.json()) as Array<[number, string, string, string, string, string]>;
        if (cancelled || !seriesRef.current) return;
        const candles: CandlestickData[] = raw.map((k) => ({
          time: (Math.floor(k[0] / 1000)) as Time,
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
        }));
        seriesRef.current.setData(candles);
        chartRef.current?.timeScale().fitContent();
        setReady(true);
      } catch (err) {
        console.error('Failed to load klines', err);
      }
    })();

    // Live WS feed
    const ws = new WebSocket(
      `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${INTERVAL}`,
    );
    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as KlineMsg;
        if (!data.k || !seriesRef.current) return;
        seriesRef.current.update({
          time: (Math.floor(data.k.t / 1000)) as Time,
          open: Number(data.k.o),
          high: Number(data.k.h),
          low: Number(data.k.l),
          close: Number(data.k.c),
        });
      } catch {}
    };

    return () => {
      cancelled = true;
      ws.close();
      wsRef.current = null;
    };
  }, [live.symbol]);

  // ─── Sync price lines (orders + anchor) on every live update ───
  useEffect(() => {
    if (!seriesRef.current || !ready) return;
    const series = seriesRef.current;
    const existing = priceLinesRef.current;

    // Build the desired set of lines, keyed by stable identity.
    // Key for orders = clientOrderId || `${side}-${price}-${status}` fallback.
    const desired = new Map<string, {
      price: number; color: string; lineWidth: 1 | 2 | 3 | 4; lineStyle: LineStyle;
      title: string; axisLabelVisible: boolean; axisLabelColor?: string; axisLabelTextColor?: string;
    }>();

    for (const o of live.orders) {
      const key = o.clientOrderId ?? `${o.side}-${o.price}-${o.status}`;
      const isOpen = o.status === 'open';
      const isBuy = o.side === 'BUY';
      const baseColor = isOpen
        ? (isBuy ? '#22c55e' : '#ef4444')
        : '#eab308'; // yellow for pending repair
      const title = isOpen
        ? `${o.side} ${trimNum(o.quantity)}`
        : `${o.side} · ${o.status}`;
      desired.set(key, {
        price: Number(o.price),
        color: baseColor,
        lineWidth: isOpen ? 2 : 1,
        lineStyle: isOpen ? LineStyle.Dashed : LineStyle.Dotted,
        title,
        axisLabelVisible: true,
        axisLabelColor: baseColor,
        axisLabelTextColor: '#ffffff',
      });
    }

    // Anchor line
    if (live.initialStartPrice) {
      desired.set('__anchor__', {
        price: Number(live.initialStartPrice),
        color: '#a78bfa',
        lineWidth: 2,
        lineStyle: LineStyle.LargeDashed,
        title: `⚓ ANCHOR ${trimNum(live.initialStartPrice)}`,
        axisLabelVisible: true,
        axisLabelColor: '#a78bfa',
        axisLabelTextColor: '#ffffff',
      });
    }

    // Remove lines no longer desired
    for (const [key, line] of existing.entries()) {
      if (!desired.has(key)) {
        try { series.removePriceLine(line); } catch {}
        existing.delete(key);
      }
    }

    // Add or update lines
    for (const [key, spec] of desired.entries()) {
      const existingLine = existing.get(key);
      if (existingLine) {
        existingLine.applyOptions(spec);
      } else {
        const line = series.createPriceLine(spec);
        existing.set(key, line);
      }
    }
  }, [live.orders, live.initialStartPrice, ready]);

  const buyOpen = live.orders.filter((o) => o.side === 'BUY' && o.status === 'open').length;
  const sellOpen = live.orders.filter((o) => o.side === 'SELL' && o.status === 'open').length;
  const failed = live.orders.filter((o) => o.status !== 'open').length;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Live chart — {live.symbol}
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-normal">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  wsConnected ? 'bg-success animate-pulse' : 'bg-muted-foreground/40'
                }`}
              />
              {wsConnected ? 'live' : 'connecting…'}
            </span>
          </CardTitle>
          <div className="flex items-center gap-1.5 flex-wrap">
            {buyOpen > 0 && (
              <Badge variant="success" className="text-[10px]">{buyOpen} BUY open</Badge>
            )}
            {sellOpen > 0 && (
              <Badge variant="destructive" className="text-[10px]">{sellOpen} SELL open</Badge>
            )}
            {failed > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] border-yellow-500/50 text-yellow-700 dark:text-yellow-400"
              >
                {failed} pending repair
              </Badge>
            )}
            <Badge variant="outline" className="font-mono text-[10px]">{INTERVAL}</Badge>
          </div>
        </div>
        <CardDescription className="text-xs">
          {KLINE_LIMIT} × {INTERVAL} candles. Grid orders overlaid as price lines —
          solid for open, dotted for pending repair. Anchor marked in purple.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-3">
        <div className="relative">
          <div
            ref={containerRef}
            className="w-full h-[560px] rounded-md overflow-hidden border bg-background"
            style={{ contain: 'layout paint' }}
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm rounded-md pointer-events-none">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="h-4 w-4 animate-pulse" />
                Loading chart…
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 border-t-[2px] border-dashed border-success" />BUY open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 border-t-[2px] border-dashed border-destructive" />SELL open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 border-t border-dotted border-yellow-500" />pending repair
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 border-t-[2px] border-dashed border-purple-400" />anchor
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function trimNum(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
