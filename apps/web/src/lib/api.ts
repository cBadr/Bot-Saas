import axios, { type AxiosInstance } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ApiResponse<T> { ok: boolean; data?: T; error?: { code: string; message: string; details?: unknown } }

const ACCESS_KEY = 'orca_access_token';
const REFRESH_KEY = 'orca_refresh_token';

export const tokenStore = {
  get access() { return typeof window === 'undefined' ? null : localStorage.getItem(ACCESS_KEY); },
  get refresh() { return typeof window === 'undefined' ? null : localStorage.getItem(REFRESH_KEY); },
  set(access: string, refresh: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && tokenStore.refresh) {
      original._retry = true;
      refreshing ??= refreshAccess();
      const newAccess = await refreshing;
      refreshing = null;
      if (newAccess) {
        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      }
      // refresh failed → logout
      tokenStore.clear();
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

async function refreshAccess(): Promise<string | null> {
  try {
    const r = await axios.post<ApiResponse<{ accessToken: string; refreshToken: string }>>(
      `${API_URL}/auth/refresh`,
      { refreshToken: tokenStore.refresh },
    );
    const data = r.data?.data;
    if (data?.accessToken && data.refreshToken) {
      tokenStore.set(data.accessToken, data.refreshToken);
      return data.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

export async function apiCall<T>(fn: () => Promise<{ data: ApiResponse<T> }>): Promise<T> {
  try {
    const r = await fn();
    if (!r.data.ok) throw new Error(r.data.error?.message ?? 'API error');
    return r.data.data as T;
  } catch (err: unknown) {
    const axiosErr = err as {
      response?: { data?: ApiResponse<unknown>; status?: number };
      message?: string;
      code?: string;
    };
    const apiMsg = axiosErr.response?.data?.error?.message;
    if (apiMsg) throw new Error(apiMsg);
    if (
      axiosErr.code === 'ERR_NETWORK' ||
      axiosErr.code === 'ECONNREFUSED' ||
      axiosErr.message === 'Network Error'
    ) {
      throw new Error(
        `Cannot reach the API server at ${API_URL}. Make sure the API is running on port 4000 (check the connection indicator in the top bar).`,
      );
    }
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
}

export interface ApiHealth {
  ok: boolean;
  checks?: { db: { ok: boolean }; redis: { ok: boolean }; binance: { ok: boolean } };
  error?: string;
}

export async function pingApi(): Promise<ApiHealth> {
  try {
    const r = await axios.get<ApiResponse<ApiHealth>>(`${API_URL}/health`, { timeout: 3000 });
    return (r.data.data as ApiHealth) ?? { ok: false, error: 'Bad response' };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return {
      ok: false,
      error: e.code === 'ERR_NETWORK' || e.message === 'Network Error' ? 'API offline' : (e.message ?? 'Unknown error'),
    };
  }
}
