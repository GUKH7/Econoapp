import { IsOptional } from 'class-validator';

export class WhatsappWebhookDto {
  @IsOptional()
  id?: unknown;

  @IsOptional()
  messageId?: unknown;

  @IsOptional()
  timestamp?: unknown;

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
  type?: unknown;

  @IsOptional()
  messageType?: unknown;

  @IsOptional()
  audio?: unknown;

  @IsOptional()
  voice?: unknown;

  @IsOptional()
  image?: unknown;

  @IsOptional()
  media?: unknown;

  @IsOptional()
  mediaUrl?: unknown;

  @IsOptional()
  url?: unknown;

  @IsOptional()
  mimeType?: unknown;

  @IsOptional()
  mimetype?: unknown;

  @IsOptional()
  seconds?: unknown;

  @IsOptional()
  duration?: unknown;

  @IsOptional()
  data?: unknown;
}
