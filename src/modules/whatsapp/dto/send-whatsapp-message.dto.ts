import { IsOptional, IsString } from 'class-validator';

export class SendWhatsappMessageDto {
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  number?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  interactions?: Array<{ id: string; label: string; value: string }>;

  @IsOptional()
  @IsString()
  audioBase64?: string;

  @IsOptional()
  @IsString()
  audioMimeType?: string;

  @IsOptional()
  asVoice?: boolean;
}
