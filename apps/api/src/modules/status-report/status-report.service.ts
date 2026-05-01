import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { env } from '@orca/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { NotificationConfig } from '../notifications/event-types';
import { BotsService } from '../bots/bots.service';

const TICK_INTERVAL_MS = 60_000; // re-evaluate every minute

/**
 * Periodic status report scheduler.
 *
 *   • Ticks every 60s.
 *   • For each user with `notificationConfig.statusReportIntervalMinutes > 0`,
 *     checks `lastStatusReportAt` and sends a comprehensive report when due.
 *   • Reports are formatted in Markdown and routed via NotificationsService
 *     (respects the user's STATUS_REPORT channel preferences).
 *   • Bot selection: 'ALL' (default) or an explicit array of bot ids.
 *
 * Single-instance assumption: in cluster mode, multiple replicas would each
 * try to send. For this app's scale that's acceptable; a Redis lock can be
 * added later if needed.
 */
@Injectable()
export class StatusReportService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StatusReportService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly bots: BotsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
    this.log.log(`Started — tick every ${TICK_INTERVAL_MS / 1000}s`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Manual trigger — sends a status report for the given user immediately,
   * bypassing the schedule. Used by the "preview" / "send now" UI button.
   */
  async sendNow(userId: string): Promise<{ ok: true; botsIncluded: number } | { ok: false; reason: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, notificationConfig: true },
    });
    if (!user) return { ok: false, reason: 'User not found' };
    const cfg = (user.notificationConfig as NotificationConfig | null) ?? {};
    const filter = cfg.statusReportBots ?? 'ALL';
    const result = await this.sendReport(user.id, filter);
    if (!result.sent) return { ok: false, reason: 'No bots match the selection' };
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastStatusReportAt: new Date() },
    });
    return { ok: true, botsIncluded: result.botCount };
  }

  // ─── Internal scheduling tick ─────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.running) return; // overlap guard
    this.running = true;
    try {
      // Pull ALL users — JSON column query in Prisma is awkward. Filter in JS.
      const users = await this.prisma.user.findMany({
        select: {
          id: true,
          lastStatusReportAt: true,
          notificationConfig: true,
        },
      });
      const now = Date.now();
      for (const u of users) {
        const cfg = (u.notificationConfig as NotificationConfig | null) ?? {};
        const interval = cfg.statusReportIntervalMinutes ?? 0;
        if (!interval || interval <= 0) continue;
        const lastMs = u.lastStatusReportAt?.getTime() ?? 0;
        if (now - lastMs < interval * 60_000) continue;

        try {
          const result = await this.sendReport(u.id, cfg.statusReportBots ?? 'ALL');
          if (result.sent) {
            await this.prisma.user.update({
              where: { id: u.id },
              data: { lastStatusReportAt: new Date() },
            });
            this.log.debug(`Status report sent to user ${u.id} (${result.botCount} bots)`);
          } else {
            // No bots match — push lastStatusReportAt forward anyway so we
            // don't recompute every tick when the user has nothing to report.
            await this.prisma.user.update({
              where: { id: u.id },
              data: { lastStatusReportAt: new Date() },
            });
          }
        } catch (e) {
          this.log.warn(`Status report failed for user ${u.id}: ${
            e instanceof Error ? e.message : String(e)
          }`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  // ─── Report builder ───────────────────────────────────────────────

  private async sendReport(
    userId: string,
    filter: 'ALL' | string[],
  ): Promise<{ sent: boolean; botCount: number }> {
    const all = await this.bots.list(userId);
    const filtered = filter === 'ALL'
      ? all
      : all.filter((b) => filter.includes(b.id));
    if (filtered.length === 0) return { sent: false, botCount: 0 };

    const message = this.formatReport(filtered);
    await this.notifications.notify(
      userId,
      'STATUS_REPORT',
      message,
      { botCount: filtered.length, botIds: filtered.map((b) => b.id) },
    );
    return { sent: true, botCount: filtered.length };
  }

  private formatReport(bots: Array<Record<string, unknown>>): string {
    const ts = new Date().toLocaleString('en-US', {
      hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric',
    });
    const link = env.PUBLIC_WEB_URL ? `\n\n[Open dashboard](${env.PUBLIC_WEB_URL}/bots)` : '';

    const sections: string[] = [];
    let totalProfit = 0;
    let runningCount = 0;

    for (const b of bots) {
      const ls = (b.liveStats as null | {
        cyclesCompleted?: number;
        realized?: number;
        unrealized?: number;
        total?: number;
        gridLevels?: number | null;
        gridSpread?: number | null;
        startPrice?: number | null;
      }) ?? null;
      const status = String(b.status ?? '—').toUpperCase();
      const isRunning = status === 'RUNNING' || status === 'STARTING';
      if (isRunning) runningCount++;
      const t = Number(ls?.total ?? 0);
      if (Number.isFinite(t)) totalProfit += t;

      const dirRaw = (b.params as Record<string, unknown> | undefined)?.direction;
      const direction = typeof dirRaw === 'string' ? ` [${dirRaw.toUpperCase()}]` : '';
      const strategyName = ((b.strategy as { name?: string } | undefined)?.name) ?? '—';
      const symbol = String(b.symbol ?? '');
      const quote = String(b.quoteAsset ?? '');
      const paper = b.paperTrading ? ' _(paper)_' : '';
      const statusEmoji = isRunning ? '🟢' : status === 'ERROR' ? '🛑' : '⚪';

      const profits = ls
        ? `Total *${signed(ls.total)}* · Realized ${signed(ls.realized)} · Floating ${signed(ls.unrealized)} ${quote}`
        : '_no live stats yet_';

      const cycles = ls?.cyclesCompleted ?? 0;
      const ladder = (ls?.gridLevels !== null && ls?.gridLevels !== undefined && ls?.gridSpread !== null && ls?.gridSpread !== undefined)
        ? `Ladder: ${ls.gridLevels} × $${num(ls.gridSpread, 2)}`
        : '';

      sections.push([
        `${statusEmoji} *${escapeMd(String(b.name ?? ''))}*${paper} — ${status}`,
        `\`${symbol}\` · ${strategyName}${direction}`,
        profits,
        `Cycles: *${cycles}*${ladder ? ` · ${ladder}` : ''}`,
      ].join('\n'));
    }

    const header = [
      `📊 *Orca Status Report*`,
      `${ts} · ${bots.length} bot${bots.length === 1 ? '' : 's'} (${runningCount} running)`,
      `Combined total: *${signed(totalProfit)}*`,
    ].join('\n');

    return [header, '', sections.join('\n\n'), link].filter(Boolean).join('\n');
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function num(v: unknown, decimals = 2): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

function signed(v: unknown, decimals = 4): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

/**
 * Escape Telegram Markdown reserved characters so bot names with `_*[\`` don't
 * break the message rendering. Conservative — only the characters that bite
 * in the Markdown (v1) parser used by the Telegram service.
 */
function escapeMd(s: string): string {
  return s.replace(/([_*`[\]])/g, '\\$1');
}
