import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { binanceTimeSync } from '@orca/exchange';
import { createLogger } from '@orca/logger';

const log = createLogger('BINANCE', { module: 'TimeSyncBootstrap' });

@Injectable()
export class BinanceSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  async onApplicationBootstrap() {
    try {
      await binanceTimeSync.start();
      log.info('Binance time sync started', { offsetMs: binanceTimeSync.getOffset() });
    } catch (err) {
      log.error('Failed to start Binance time sync', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  onModuleDestroy() {
    binanceTimeSync.stop();
  }
}
