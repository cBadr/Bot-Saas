import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number | string, opts: Intl.NumberFormatOptions = {}) {
  const num = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(num)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8, ...opts }).format(num);
}

export function formatCurrency(n: number | string, currency = 'USD') {
  const num = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(num)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(num);
}

export function formatRelativeTime(date: string | Date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/**
 * Format a duration as `Xd Yh Zm` with units omitted when their value is 0.
 *  - 1m → "1m"
 *  - 1h 0m → "1h"
 *  - 5h 23m → "5h 23m"
 *  - 2d 0h 0m → "2d"
 *  - 2d 5h 23m → "2d 5h 23m"
 *  - <1m → "<1m"
 */
export function formatDuration(date: string | Date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Math.max(0, Date.now() - d.getTime());
  const min = Math.floor(diff / 60_000);
  if (min === 0) return '<1m';
  const days = Math.floor(min / (24 * 60));
  const hours = Math.floor((min % (24 * 60)) / 60);
  const minutes = min % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.length ? parts.join(' ') : `${min}m`;
}
