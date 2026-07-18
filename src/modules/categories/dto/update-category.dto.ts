import { BusinessCostType } from '@prisma/client';
import { IsHexColor, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsIn([BusinessCostType.VARIABLE, BusinessCostType.FIXED, null])
  businessCostType?: BusinessCostType | null;
}
