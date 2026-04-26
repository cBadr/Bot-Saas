import { Injectable } from '@nestjs/common';
import { request } from 'undici';
import { env } from '@orca/config';
import { createLogger } from '@orca/logger';

const log = createLogger('SYSTEM', { module: 'Telegram' });

@Injectable()
export class TelegramService {
  async send(chatId: string, text: string, opts?: { parseMode?: 'Markdown' | 'HTML' }): Promise<boolean> {
    if (!env.TELEGRAM_BOT_TOKEN) {
      log.warn('TELEGRAM_BOT_TOKEN not configured, skipping send');
      return false;
    }
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
      const res = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: opts?.parseMode ?? 'Markdown',
          disable_web_page_preview: true,
        }),
      });
      if (res.statusCode >= 200 && res.statusCode < 300) return true;
      const body = await res.body.text();
      log.warn('Telegram send failed', { status: res.statusCode, body });
      return false;
    } catch (err) {
      log.error('Telegram send error', { err: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }
}
