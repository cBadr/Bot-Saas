import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ExchangeKeysModule } from './modules/exchange-keys/exchange-keys.module';
import { StrategiesModule } from './modules/strategies/strategies.module';
import { BotsModule } from './modules/bots/bots.module';
import { HealthModule } from './modules/health/health.module';
import { BinanceSyncModule } from './modules/binance-sync/binance-sync.module';
import { PlansModule } from './modules/plans/plans.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BacktestModule } from './modules/backtest/backtest.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { WalletModule } from './modules/wallet/wallet.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 200 }]),
    PrismaModule,
    RedisModule,
    AuditModule,
    NotificationsModule,
    BinanceSyncModule,
    AuthModule,
    UsersModule,
    ExchangeKeysModule,
    StrategiesModule,
    BotsModule,
    HealthModule,
    PlansModule,
    SubscriptionsModule,
    PaymentsModule,
    ReportsModule,
    BacktestModule,
    RealtimeModule,
    WalletModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
