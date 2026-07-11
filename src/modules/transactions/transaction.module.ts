import { Module } from '@nestjs/common';
import { AccountModule } from '@/modules/accounts/account.module';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { TransactionRepository } from './repositories/transaction.repository';
import { SmartCategoryService } from './smart-category.service';
import { RecurringTransactionService } from './recurring-transaction.service';

@Module({
  imports: [AccountModule],
  controllers: [TransactionController],
  providers: [TransactionService, TransactionRepository, SmartCategoryService, RecurringTransactionService],
  exports: [TransactionService, TransactionRepository, SmartCategoryService, RecurringTransactionService],
})
export class TransactionModule {}
