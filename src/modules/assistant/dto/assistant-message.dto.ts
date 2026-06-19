import { IsString, MaxLength, MinLength } from 'class-validator';

export class AssistantMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(700)
  message!: string;
}
