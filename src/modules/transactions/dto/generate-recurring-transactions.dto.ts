import { IsDateString, IsOptional } from 'class-validator';

export class GenerateRecurringTransactionsDto {
  @IsOptional()
  @IsDateString()
  until?: string;
}
