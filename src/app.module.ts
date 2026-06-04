import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from '@/common/guards/throttler.guard';
import { LoggerModule } from 'nestjs-pino';
import { env } from '@/config/env';
import { DatabaseModule } from '@/config/database.module';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { AuthGuard } from '@/common/guards/auth.guard';
import { AuthModule } from '@/modules/auth/auth.module';
import { TransactionModule } from '@/modules/transactions/transaction.module';
import { ChannelModule } from '@/modules/channels/channel.module';
import { CategoryModule } from '@/modules/categories/category.module';
import { AccountModule } from '@/modules/accounts/account.module';
import { DashboardModule } from '@/modules/dashboard/dashboard.module';
import { HealthModule } from '@/modules/health/health.module';
import { TelegramModule } from '@/modules/telegram/telegram.module';

@Module({
  imports: [
    DatabaseModule,
    LoggerModule.forRoot({
      pinoHttp:
        env.NODE_ENV === 'development'
          ? {
              transport: {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                },
              },
            }
          : {},
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 60,
      },
    ]),
    JwtModule.register({
      global: true,
      secret: env.JWT_SECRET,
      signOptions: { expiresIn: env.JWT_EXPIRES_IN },
    }),
    AuthModule,
    TransactionModule,
    ChannelModule,
    CategoryModule,
    AccountModule,

    TelegramModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
