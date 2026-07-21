import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum InsightAction {
  CREATE_BUDGET = 'CREATE_BUDGET',
  REMIND_LATER = 'REMIND_LATER',
  IGNORE = 'IGNORE',
}

export class InsightActionDto {
  @IsEnum(InsightAction)
  action!: InsightAction;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  remindInHours?: number;
}
