import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '@orca/config';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [JwtModule.register({ secret: env.AUTH_SECRET })],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
