import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsString, Max, Min } from 'class-validator';

export const BUSINESS_TYPES = ['COMMERCE', 'SERVICES', 'FOOD', 'BEAUTY', 'FREELANCER', 'OTHER'] as const;

export class CompleteBusinessOnboardingDto {
  @IsIn(BUSINESS_TYPES)
  businessType!: typeof BUSINESS_TYPES[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  salesChannels!: string[];

  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  recurringExpenses!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  receivingMethods!: string[];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  revenueGoal!: number;

  @IsBoolean()
  reserveTaxes!: boolean;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate!: number;
}
