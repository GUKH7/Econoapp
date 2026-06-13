import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtPayload } from '@/common/types';
import { BudgetService } from './budget.service';
import { UpsertCategoryBudgetDto } from './dto/upsert-category-budget.dto';

@ApiTags('Budgets')
@ApiBearerAuth('access-token')
@Controller('budgets')
export class BudgetController {
  constructor(@Inject(BudgetService) private readonly budgetService: BudgetService) {}

  @ApiOperation({ summary: 'Listar orçamentos do mês atual' })
  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query('scope') scope?: string) {
    const data = await this.budgetService.listCurrentMonth(user.sub, scope);
    return { data };
  }

  @ApiOperation({ summary: 'Criar ou atualizar orçamento mensal por categoria' })
  @Post()
  async upsert(@CurrentUser() user: JwtPayload, @Body() dto: UpsertCategoryBudgetDto) {
    const data = await this.budgetService.upsert(user.sub, dto);
    return { data };
  }

  @ApiOperation({ summary: 'Remover orçamento mensal' })
  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.budgetService.remove(user.sub, id);
    return { data: { success: true } };
  }
}
