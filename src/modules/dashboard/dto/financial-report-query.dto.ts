import { FinancialScope } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export class FinancialReportQueryDto {
  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-07-31' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ enum: FinancialScope })
  @IsOptional()
  @IsEnum(FinancialScope)
  scope?: FinancialScope;
}
