import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards/auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtPayload } from '@/common/types';
import { CategoryResponse } from '@/common/types/response.types';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Categories')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('categories')
export class CategoryController {
  constructor(@Inject(CategoryService) private readonly categoryService: CategoryService) {}

  @ApiOperation({ summary: 'Criar nova categoria' })
  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCategoryDto,
  ): Promise<{ data: CategoryResponse }> {
    const data = await this.categoryService.create(user.sub, dto);
    return { data };
  }

  @ApiOperation({ summary: 'Listar categorias do usuário autenticado' })
  @Get()
  async list(@CurrentUser() user: JwtPayload): Promise<{ data: CategoryResponse[] }> {
    const data = await this.categoryService.findAllByUser(user.sub);
    return { data };
  }

  @ApiOperation({ summary: 'Atualizar categoria por ID' })
  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<{ data: CategoryResponse }> {
    const data = await this.categoryService.update(user.sub, id, dto);
    return { data };
  }

  @ApiOperation({ summary: 'Remover categoria por ID' })
  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.categoryService.delete(user.sub, id);
  }
}
