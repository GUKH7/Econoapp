-- Add CSV as an import source and store a per-user hash to skip duplicated imported rows.
ALTER TYPE "TransactionSource" ADD VALUE IF NOT EXISTS 'CSV';

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "importHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_userId_importHash_key" ON "Transaction"("userId", "importHash");