import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class SettleBusinessEntryDto {
  @IsOptional()
  @IsDateString()
  settledAt?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}
