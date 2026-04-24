import { Inject, Injectable } from '@nestjs/common';
import { ChannelRepository } from './repositories/channel.repository';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelService {
  constructor(@Inject(ChannelRepository) private readonly channelRepository: ChannelRepository) {}

  create(userId: string, input: CreateChannelDto) {
    return this.channelRepository.create(userId, input);
  }

  findAllByUser(userId: string) {
    return this.channelRepository.findAllByUser(userId);
  }

  async update(userId: string, id: string, input: UpdateChannelDto): Promise<void> {
    await this.channelRepository.update(userId, id, input);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.channelRepository.delete(userId, id);
  }
}
