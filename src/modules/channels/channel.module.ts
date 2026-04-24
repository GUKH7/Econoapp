import { Module } from '@nestjs/common';
import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';
import { ChannelRepository } from './repositories/channel.repository';

@Module({
  controllers: [ChannelController],
  providers: [ChannelService, ChannelRepository],
  exports: [ChannelService],
})
export class ChannelModule {}
