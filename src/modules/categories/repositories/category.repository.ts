import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@/config/database';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';

@Injectable()
export class CategoryRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(userId: string, input: CreateCategoryDto) {
    return this.prisma.category.create({
      data: {
        name: input.name,
        color: input.color ?? '#6366f1',
        userId,
      },
    });
  }

  findAllByUser(userId: string) {
    return this.prisma.category.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  findById(id: string, userId: string) {
    return this.prisma.category.findFirst({ where: { id, userId } });
  }

  async update(id: string, userId: string, input: UpdateCategoryDto) {
    await this.prisma.category.updateMany({
      where: { id, userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
    });

    return this.prisma.category.findFirstOrThrow({ where: { id, userId } });
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.prisma.category.deleteMany({ where: { id, userId } });
  }
}
