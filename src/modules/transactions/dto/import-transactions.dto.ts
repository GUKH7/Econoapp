import { FinancialScope } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class ImportTransactionsDto {
  @IsString()
  @MinLength(10)
  csv!: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(FinancialScope)
  scope?: FinancialScope;
}