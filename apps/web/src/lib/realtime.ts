'use client';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { tokenStore } from './api';

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? 'wss://orcax.click';

let socket: Socket | null = null;

function getSocket(): Socket {
  if (socket && socket.connected) return socket;
  socket?.close();
  socket = io(WS_URL, {
    transports: ['websocket'],
    auth: { token: tokenStore.access ?? '' },
    reconnection: true,
    reconnectionDelay: 1500,
  });
  return socket;
}

export interface BotEventPayload {
  type: 'BOT_STATUS' | 'BOT_EVENT';
  botId: string;
  status?: string;
  event?: string;
  data?: Record<string, unknown>;
  message?: string;
}

/**
 * Hook: subscribes to live updates for a specific bot.
 * On each event, invalidates the relevant React Query caches.
 */
export function useBotRealtime(botId: string | undefined) {
  const qc = useQueryClient();
  const subscribed = useRef(false);

  useEffect(() => {
    if (!botId || !tokenStore.access) return;
    const s = getSocket();

    const onConnect = () => {
      s.emit('subscribe:bot', botId);
      subscribed.current = true;
    };
    const onEvent = (evt: BotEventPayload) => {
      if (evt.botId !== botId) return;
      // Invalidate caches that depend on this bot
      qc.invalidateQueries({ queryKey: ['bot', botId] });
      qc.invalidateQueries({ queryKey: ['bot-events', botId] });
      qc.invalidateQueries({ queryKey: ['bot-orders', botId] });
      qc.invalidateQueries({ queryKey: ['bots'] });
    };

    if (s.connected) onConnect();
    else s.on('connect', onConnect);
    s.on('bot:event', onEvent);

    return () => {
      if (subscribed.current) s.emit('unsubscribe:bot', botId);
      s.off('bot:event', onEvent);
      s.off('connect', onConnect);
      subscribed.current = false;
    };
  }, [botId, qc]);
}

/**
 * Hook: live updates for ALL of the user's bots (used on Bots list page).
 * Listens to user-room — automatically receives events for any bot the user owns.
 */
export function useUserBotsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    if (!tokenStore.access) return;
    const s = getSocket();
    const onEvent = (evt: BotEventPayload) => {
      qc.invalidateQueries({ queryKey: ['bots'] });
      if (evt.botId) {
        qc.invalidateQueries({ queryKey: ['bot', evt.botId] });
        qc.invalidateQueries({ queryKey: ['bot-events', evt.botId] });
        qc.invalidateQueries({ queryKey: ['bot-orders', evt.botId] });
      }
    };
    s.on('bot:event', onEvent);
    return () => { s.off('bot:event', onEvent); };
  }, [qc]);
}

export function disconnectRealtime() {
  if (socket) {
    socket.close();
    socket = null;
  }
}
