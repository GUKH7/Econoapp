import { FinancialAccountType, FinancialScope } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateFinancialAccountDto {
  @IsString()
  name!: string;

  @IsEnum(FinancialAccountType)
  type!: FinancialAccountType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  balance?: number;

  @IsOptional()
  @IsEnum(FinancialScope)
  scope?: FinancialScope;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
