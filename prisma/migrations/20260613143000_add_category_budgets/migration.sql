CREATE TABLE "CategoryBudget" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  "scope" "FinancialScope" NOT NULL DEFAULT 'PERSONAL',
  "month" TIMESTAMPTZ(6) NOT NULL,
  "amount" DECIMAL(15,4) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CategoryBudget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CategoryBudget_userId_categoryId_scope_month_key"
  ON "CategoryBudget"("userId", "categoryId", "scope", "month");

CREATE INDEX "CategoryBudget_userId_scope_month_idx"
  ON "CategoryBudget"("userId", "scope", "month");

ALTER TABLE "CategoryBudget"
  ADD CONSTRAINT "CategoryBudget_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CategoryBudget"
  ADD CONSTRAINT "CategoryBudget_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
