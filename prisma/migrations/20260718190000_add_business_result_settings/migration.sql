CREATE TYPE "BusinessCostType" AS ENUM ('VARIABLE', 'FIXED');

ALTER TABLE "Category" ADD COLUMN "businessCostType" "BusinessCostType";

CREATE TABLE "BusinessSettings" (
  "userId" UUID NOT NULL,
  "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "taxConfigured" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BusinessSettings_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
