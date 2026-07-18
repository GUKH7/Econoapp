CREATE TYPE "BusinessOfferingType" AS ENUM ('PRODUCT', 'SERVICE');

CREATE TABLE "BusinessOffering" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "BusinessOfferingType" NOT NULL,
    "name" TEXT NOT NULL,
    "estimatedUnitCost" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "defaultPrice" DECIMAL(15,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "BusinessOffering_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BusinessEntry" ADD COLUMN "offeringId" UUID,
ADD COLUMN "quantity" DECIMAL(15,4) NOT NULL DEFAULT 1;

ALTER TABLE "Transaction" ADD COLUMN "offeringId" UUID,
ADD COLUMN "quantity" DECIMAL(15,4) NOT NULL DEFAULT 1,
ADD COLUMN "unitCost" DECIMAL(15,4);

CREATE INDEX "BusinessOffering_userId_type_name_idx" ON "BusinessOffering"("userId", "type", "name");
CREATE INDEX "BusinessEntry_userId_offeringId_idx" ON "BusinessEntry"("userId", "offeringId");
CREATE INDEX "Transaction_offeringId_idx" ON "Transaction"("offeringId");

ALTER TABLE "BusinessOffering" ADD CONSTRAINT "BusinessOffering_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessEntry" ADD CONSTRAINT "BusinessEntry_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "BusinessOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "BusinessOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;
