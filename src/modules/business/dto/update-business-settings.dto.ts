import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class UpdateBusinessSettingsDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate!: number;
}
