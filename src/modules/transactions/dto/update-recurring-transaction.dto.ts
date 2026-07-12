import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateRecurringTransactionDto } from './create-recurring-transaction.dto';

export class UpdateRecurringTransactionDto extends PartialType(
  OmitType(CreateRecurringTransactionDto, ['generateFirst'] as const),
) {}
