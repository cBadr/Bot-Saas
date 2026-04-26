import { createHmac } from 'node:crypto';

export function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return entries.join('&');
}

export function signPayload(query: string, apiSecret: string): string {
  return createHmac('sha256', apiSecret).update(query).digest('hex');
}
