import { Global, Module } from '@nestjs/common';
import { BinanceSyncService } from './binance-sync.service';

@Global()
@Module({
  providers: [BinanceSyncService],
  exports: [BinanceSyncService],
})
export class BinanceSyncModule {}
