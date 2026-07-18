import { BusinessCostType } from '@prisma/client';
import { IsEnum, IsHexColor, IsOptional, IsString } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsEnum(BusinessCostType)
  businessCostType?: BusinessCostType;
}
