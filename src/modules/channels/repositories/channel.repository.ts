import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@/config/database';
import { CreateChannelDto } from '../dto/create-channel.dto';
import { UpdateChannelDto } from '../dto/update-channel.dto';

@Injectable()
export class ChannelRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(userId: string, input: CreateChannelDto) {
    return this.prisma.salesChannel.create({ data: { ...input, isActive: input.isActive ?? true, userId } });
  }

  findAllByUser(userId: string) {
    return this.prisma.salesChannel.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  update(userId: string, id: string, input: UpdateChannelDto) {
    return this.prisma.salesChannel.updateMany({ where: { id, userId }, data: input });
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.prisma.salesChannel.deleteMany({ where: { id, userId } });
  }
}
