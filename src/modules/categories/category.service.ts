import { Inject, Injectable } from '@nestjs/common';
import { NotFoundException, ForbiddenException } from '@/common/errors/app.exception';
import { CategoryRepository } from './repositories/category.repository';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoryService {
  constructor(
    @Inject(CategoryRepository) private readonly categoryRepository: CategoryRepository,
  ) {}

  create(userId: string, input: CreateCategoryDto) {
    return this.categoryRepository.create(userId, input);
  }

  findAllByUser(userId: string) {
    return this.categoryRepository.findAllByUser(userId);
  }

  async update(userId: string, id: string, input: UpdateCategoryDto) {
    const existing = await this.categoryRepository.findById(id, userId);
    if (!existing) throw new NotFoundException('Categoria não encontrada');
    if (existing.userId !== userId) throw new ForbiddenException('Sem permissão');
    return this.categoryRepository.update(id, userId, input);
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.categoryRepository.findById(id, userId);
    if (!existing) throw new NotFoundException('Categoria não encontrada');
    if (existing.userId !== userId) throw new ForbiddenException('Sem permissão');
    await this.categoryRepository.delete(id, userId);
  }
}
