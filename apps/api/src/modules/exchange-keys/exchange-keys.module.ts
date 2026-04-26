import { Module } from '@nestjs/common';
import { ExchangeKeysService } from './exchange-keys.service';
import { ExchangeKeysController } from './exchange-keys.controller';

@Module({
  providers: [ExchangeKeysService],
  controllers: [ExchangeKeysController],
  exports: [ExchangeKeysService],
})
export class ExchangeKeysModule {}
