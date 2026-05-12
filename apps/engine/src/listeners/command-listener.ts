import type Redis from 'ioredis';
import { createLogger } from '@orca/logger';
import { ENGINE_COMMAND_CHANNEL, type EngineCommand } from '../bridge/channels';
import type { RunnerManager } from '../runners/runner-manager';

const log = createLogger('BOT', { module: 'CommandListener' });

export class CommandListener {
  constructor(
    private readonly subscriber: Redis,
    private readonly manager: RunnerManager,
  ) {}

  async start(): Promise<void> {
    await this.subscriber.subscribe(ENGINE_COMMAND_CHANNEL);
    this.subscriber.on('message', (channel, raw) => {
      if (channel !== ENGINE_COMMAND_CHANNEL) return;
      void this.handle(raw);
    });
    log.info(`Subscribed to ${ENGINE_COMMAND_CHANNEL}`);
  }

  private async handle(raw: string): Promise<void> {
    let cmd: EngineCommand;
    try { cmd = JSON.parse(raw) as EngineCommand; }
    catch (err) { log.warn('Bad command payload', { err: String(err), raw }); return; }
    log.info('Command received', { cmd });
    try {
      switch (cmd.type) {
        case 'START':
          await this.manager.startBot(cmd.botId);
          break;
        case 'STOP':
          await this.manager.stopBot(cmd.botId);
          break;
        case 'EMERGENCY_STOP_USER':
          await this.manager.stopUserBots(cmd.userId, 'Emergency stop');
          break;
        case 'CANCEL_PENDING':
          // TODO: route to runner.cancelPending(); for now log so the API ack
          // shows traceably in engine logs.
          log.warn('CANCEL_PENDING received but engine handler not yet implemented', { botId: cmd.botId });
          break;
      }
    } catch (err) {
      log.error('Command handler error', {
        cmd,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
