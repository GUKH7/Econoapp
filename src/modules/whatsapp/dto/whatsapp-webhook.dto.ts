import { IsOptional } from 'class-validator';

export class WhatsappWebhookDto {
  @IsOptional()
  phone?: unknown;

  @IsOptional()
  number?: unknown;

  @IsOptional()
  from?: unknown;

  @IsOptional()
  to?: unknown;

  @IsOptional()
  message?: unknown;

  @IsOptional()
  text?: unknown;

  @IsOptional()
  body?: unknown;

  @IsOptional()
  data?: unknown;
}
