import { Global, Module } from '@nestjs/common';
import { PrismaService } from './database';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
