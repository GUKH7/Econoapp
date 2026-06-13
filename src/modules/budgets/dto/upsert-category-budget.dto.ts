import { FinancialScope } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsUUID, Min } from 'class-validator';

export class UpsertCategoryBudgetDto {
  @IsUUID()
  categoryId!: string;

  @IsEnum(FinancialScope)
  scope!: FinancialScope;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;
}
