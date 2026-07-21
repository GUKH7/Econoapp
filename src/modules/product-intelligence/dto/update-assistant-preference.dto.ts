import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateAssistantPreferenceDto {
  @IsOptional() @IsBoolean() audioRepliesEnabled?: boolean;
  @IsOptional() @IsBoolean() proactiveAlertsEnabled?: boolean;
  @IsOptional() @IsBoolean() anomalyAlertsEnabled?: boolean;
  @IsOptional() @IsBoolean() forecastAlertsEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(23) quietHoursStart?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) quietHoursEnd?: number;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsInt() @Min(0) @Max(14) maxWeeklyAlerts?: number;
}
