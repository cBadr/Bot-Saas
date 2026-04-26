import { Module } from '@nestjs/common';
import { StrategiesService } from './strategies.service';
import { StrategiesController } from './strategies.controller';

@Module({
  providers: [StrategiesService],
  controllers: [StrategiesController],
  exports: [StrategiesService],
})
export class StrategiesModule {}
