import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiCall, tokenStore } from './api';

// ─── Password reset ───
export const useForgotPassword = () =>
  useMutation({
    mutationFn: (email: string) =>
      apiCall<{ ok: true; devToken?: string }>(() =>
        api.post('/auth/forgot-password', { email }),
      ),
  });

export const useResetPassword = () =>
  useMutation({
    mutationFn: (input: { token: string; newPassword: string }) =>
      apiCall(() => api.post('/auth/reset-password', input)),
  });

// ─── In-app notifications ───
export interface InboxItem {
  id: string;
  channel: string;
  eventType: string;
  payload: { message?: string; [k: string]: unknown };
  success: boolean;
  error: string | null;
  createdAt: string;
}

export const useInbox = () =>
  useQuery({
    queryKey: ['notifications', 'inbox'],
    queryFn: () =>
      apiCall<{ items: InboxItem[]; unreadCount: number }>(() =>
        api.get('/notifications/inbox'),
      ),
    enabled: !!tokenStore.access,
    refetchInterval: 30_000,
  });

export const useMarkRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.patch(`/notifications/${id}/read`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
};

export const useMarkAllRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiCall(() => api.post('/notifications/mark-all-read')),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
};

// ─── Notification preferences ───
export interface NotificationPreference {
  id: string;
  userId: string;
  channel: 'TELEGRAM' | 'EMAIL' | 'DISCORD' | 'IN_APP' | 'PUSH';
  eventType: string;
  enabled: boolean;
}

export const useNotificationPreferences = () =>
  useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () =>
      apiCall<NotificationPreference[]>(() => api.get('/notifications/preferences')),
    enabled: !!tokenStore.access,
  });

export const useSetNotificationPreference = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      channel: 'TELEGRAM' | 'EMAIL' | 'DISCORD' | 'IN_APP' | 'PUSH';
      eventType: string;
      enabled: boolean;
    }) => apiCall<NotificationPreference>(() => api.patch('/notifications/preferences', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'preferences'] }),
  });
};
