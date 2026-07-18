import { AccountAccessStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateUserAccessDto {
  @IsEnum(AccountAccessStatus)
  status!: AccountAccessStatus;
}
