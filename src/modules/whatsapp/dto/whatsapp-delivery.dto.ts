import { IsIn, IsString, MaxLength } from 'class-validator';

export class WhatsappDeliveryDto {
  @IsString()
  @MaxLength(200)
  messageId!: string;

  @IsString()
  @IsIn(['SENT', 'DELIVERED', 'READ', 'FAILED'])
  status!: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
}
