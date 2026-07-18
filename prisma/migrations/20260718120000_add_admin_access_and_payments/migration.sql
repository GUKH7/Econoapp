CREATE TYPE "AccountAccessStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

ALTER TABLE "User"
ADD COLUMN "accessStatus" "AccountAccessStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "paidUntil" TIMESTAMPTZ(6);

ALTER TABLE "User" ALTER COLUMN "accessStatus" SET DEFAULT 'PENDING';

CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "recordedById" UUID NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "paidAt" TIMESTAMPTZ(6) NOT NULL,
  "validUntil" TIMESTAMPTZ(6) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Payment_userId_paidAt_idx" ON "Payment"("userId", "paidAt");
CREATE INDEX "Payment_validUntil_idx" ON "Payment"("validUntil");

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_recordedById_fkey"
FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
