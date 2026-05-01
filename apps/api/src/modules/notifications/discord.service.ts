import { Injectable } from '@nestjs/common';
import { request } from 'undici';
import { createLogger } from '@orca/logger';

const log = createLogger('SYSTEM', { module: 'Discord' });

@Injectable()
export class DiscordService {
  /** Posts a webhook message. URL is per-user (stored on User.discordWebhookUrl). */
  async send(webhookUrl: string, content: string, opts?: { title?: string }): Promise<boolean> {
    if (!webhookUrl || !/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(webhookUrl)) {
      log.warn('Invalid Discord webhook URL, skipping');
      return false;
    }
    const embed = {
      title: opts?.title ?? '🐋 Orca',
      description: content.length > 4000 ? content.slice(0, 3997) + '...' : content,
      color: 0x60a5fa,
      timestamp: new Date().toISOString(),
    };
    try {
      const res = await request(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (res.statusCode >= 200 && res.statusCode < 300) return true;
      const body = await res.body.text();
      log.warn('Discord webhook failed', { status: res.statusCode, body });
      return false;
    } catch (err) {
      log.error('Discord send error', { err: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }
}
