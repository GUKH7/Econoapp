import { TransactionSource, TransactionType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateTransactionDto {
  @IsString()
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsOptional()
  @IsEnum(TransactionSource)
  source?: TransactionSource;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}
