CREATE TYPE "BusinessEntryType" AS ENUM ('RECEIVABLE', 'PAYABLE');
CREATE TYPE "BusinessEntryStatus" AS ENUM ('PENDING', 'SETTLED', 'CANCELLED');
ALTER TYPE "ScheduledNotificationType" ADD VALUE 'BUSINESS_RECEIVABLE_DUE';
ALTER TYPE "ScheduledNotificationType" ADD VALUE 'BUSINESS_PAYABLE_DUE';

CREATE TABLE "BusinessEntry" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "type" "BusinessEntryType" NOT NULL,
  "status" "BusinessEntryStatus" NOT NULL DEFAULT 'PENDING',
  "title" TEXT NOT NULL,
  "counterparty" TEXT NOT NULL,
  "amount" DECIMAL(15,4) NOT NULL,
  "dueDate" TIMESTAMPTZ(6) NOT NULL,
  "settledAt" TIMESTAMPTZ(6),
  "categoryId" UUID NOT NULL,
  "accountId" UUID,
  "recurrenceFrequency" "RecurrenceFrequency",
  "recurrenceEndDate" TIMESTAMPTZ(6),
  "seriesId" UUID,
  "transactionId" UUID,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BusinessEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessEntry_transactionId_key" ON "BusinessEntry"("transactionId");
CREATE INDEX "BusinessEntry_userId_type_status_dueDate_idx" ON "BusinessEntry"("userId", "type", "status", "dueDate");
CREATE INDEX "BusinessEntry_userId_seriesId_dueDate_idx" ON "BusinessEntry"("userId", "seriesId", "dueDate");

ALTER TABLE "BusinessEntry" ADD CONSTRAINT "BusinessEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessEntry" ADD CONSTRAINT "BusinessEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessEntry" ADD CONSTRAINT "BusinessEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessEntry" ADD CONSTRAINT "BusinessEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
