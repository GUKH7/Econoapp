ALTER TYPE "TransactionSource" ADD VALUE IF NOT EXISTS 'RECURRENT';

DO $$ BEGIN
  CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "RecurringTransaction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(15,4) NOT NULL,
  "type" "TransactionType" NOT NULL,
  "scope" "FinancialScope" NOT NULL DEFAULT 'PERSONAL',
  "categoryId" UUID NOT NULL,
  "channelId" UUID,
  "accountId" UUID,
  "creditCardId" UUID,
  "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'MONTHLY',
  "interval" INTEGER NOT NULL DEFAULT 1,
  "startDate" TIMESTAMPTZ(6) NOT NULL,
  "nextRunAt" TIMESTAMPTZ(6) NOT NULL,
  "endDate" TIMESTAMPTZ(6),
  "maxOccurrences" INTEGER,
  "generatedCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringTransaction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "recurringRuleId" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_recurringRuleId_date_key" ON "Transaction"("recurringRuleId", "date");
CREATE INDEX IF NOT EXISTS "Transaction_recurringRuleId_idx" ON "Transaction"("recurringRuleId");
CREATE INDEX IF NOT EXISTS "RecurringTransaction_userId_isActive_nextRunAt_idx" ON "RecurringTransaction"("userId", "isActive", "nextRunAt");
CREATE INDEX IF NOT EXISTS "RecurringTransaction_categoryId_idx" ON "RecurringTransaction"("categoryId");
CREATE INDEX IF NOT EXISTS "RecurringTransaction_accountId_idx" ON "RecurringTransaction"("accountId");
CREATE INDEX IF NOT EXISTS "RecurringTransaction_creditCardId_idx" ON "RecurringTransaction"("creditCardId");

DO $$ BEGIN
  ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "SalesChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "RecurringTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;