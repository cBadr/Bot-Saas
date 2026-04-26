import { Module } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';

@Module({
  providers: [BacktestService],
  controllers: [BacktestController],
})
export class BacktestModule {}
