import { Global, Module } from '@nestjs/common';
import { PrismaService } from './database';
import { SystemSettingsService } from './system-settings.service';

@Global()
@Module({
  providers: [PrismaService, SystemSettingsService],
  exports: [PrismaService, SystemSettingsService],
})
export class DatabaseModule {}
