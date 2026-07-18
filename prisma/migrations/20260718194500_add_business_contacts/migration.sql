CREATE TYPE "BusinessContactType" AS ENUM ('CLIENT', 'SUPPLIER', 'BOTH');

CREATE TABLE "BusinessContact" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "BusinessContactType" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BusinessContact_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BusinessEntry" ADD COLUMN "contactId" UUID;

CREATE INDEX "BusinessContact_userId_type_name_idx" ON "BusinessContact"("userId", "type", "name");
CREATE INDEX "BusinessEntry_userId_contactId_idx" ON "BusinessEntry"("userId", "contactId");

ALTER TABLE "BusinessContact" ADD CONSTRAINT "BusinessContact_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessEntry" ADD CONSTRAINT "BusinessEntry_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "BusinessContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
