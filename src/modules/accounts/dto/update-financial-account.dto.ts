import { PartialType } from '@nestjs/mapped-types';
import { CreateFinancialAccountDto } from './create-financial-account.dto';

export class UpdateFinancialAccountDto extends PartialType(CreateFinancialAccountDto) {}
