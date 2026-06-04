CREATE TYPE "FinancialScope" AS ENUM ('PERSONAL', 'BUSINESS');
CREATE TYPE "FinancialAccountType" AS ENUM ('BANK', 'WALLET');

CREATE TABLE "FinancialAccount" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "type" "FinancialAccountType" NOT NULL,
  "balance" DECIMAL(15,4) NOT NULL DEFAULT 0,
  "scope" "FinancialScope" NOT NULL DEFAULT 'PERSONAL',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditCard" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "limit" DECIMAL(15,4) NOT NULL DEFAULT 0,
  "closingDay" INTEGER,
  "dueDay" INTEGER,
  "scope" "FinancialScope" NOT NULL DEFAULT 'PERSONAL',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CreditCard_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Transaction"
  ADD COLUMN "scope" "FinancialScope" NOT NULL DEFAULT 'PERSONAL',
  ADD COLUMN "accountId" UUID,
  ADD COLUMN "creditCardId" UUID;

CREATE INDEX "FinancialAccount_userId_scope_idx" ON "FinancialAccount"("userId", "scope");
CREATE INDEX "CreditCard_userId_scope_idx" ON "CreditCard"("userId", "scope");
CREATE INDEX "Transaction_userId_scope_idx" ON "Transaction"("userId", "scope");
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");
CREATE INDEX "Transaction_creditCardId_idx" ON "Transaction"("creditCardId");

ALTER TABLE "FinancialAccount"
  ADD CONSTRAINT "FinancialAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CreditCard"
  ADD CONSTRAINT "CreditCard_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_creditCardId_fkey"
  FOREIGN KEY ("creditCardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
