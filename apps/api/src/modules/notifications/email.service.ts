import { Injectable } from '@nestjs/common';
import { request } from 'undici';
import { env } from '@orca/config';
import { createLogger } from '@orca/logger';

const log = createLogger('SYSTEM', { module: 'Email' });

@Injectable()
export class EmailService {
  /** Returns true if Resend is configured and a send was attempted successfully. */
  async send(to: string, subject: string, body: string): Promise<boolean> {
    if (!env.RESEND_API_KEY) {
      log.warn('RESEND_API_KEY not configured, skipping email send');
      return false;
    }
    try {
      const res = await request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.RESEND_FROM,
          to: [to],
          subject,
          html: this.renderHtml(subject, body),
          text: body,
        }),
      });
      if (res.statusCode >= 200 && res.statusCode < 300) return true;
      const errBody = await res.body.text();
      log.warn('Resend send failed', { status: res.statusCode, body: errBody });
      return false;
    } catch (err) {
      log.error('Email send error', { err: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  private renderHtml(subject: string, body: string): string {
    const safeBody = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
    return `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0b0e14;color:#e5e7eb;margin:0;padding:24px"><div style="max-width:560px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:12px;padding:24px"><div style="font-size:20px;font-weight:600;color:#60a5fa;margin-bottom:12px">🐋 Orca</div><div style="font-size:16px;font-weight:500;margin-bottom:16px">${subject}</div><div style="font-size:14px;line-height:1.6;color:#cbd5e1">${safeBody}</div></div></body></html>`;
  }
}
