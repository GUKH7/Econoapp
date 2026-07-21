CREATE TYPE "WhatsappInboundStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER');
CREATE TYPE "WhatsappOutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'DEAD_LETTER');

ALTER TABLE "Transaction" ADD COLUMN "sourceEventKey" TEXT;
CREATE UNIQUE INDEX "Transaction_sourceEventKey_key" ON "Transaction"("sourceEventKey");

CREATE TABLE "WhatsappInboundMessage" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "externalMessageId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WhatsappInboundStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ(6),
  "processedAt" TIMESTAMPTZ(6),
  "replyText" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "WhatsappInboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappOutboxMessage" (
  "id" UUID NOT NULL,
  "inboundMessageId" UUID,
  "phone" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "WhatsappOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ(6),
  "sentAt" TIMESTAMPTZ(6),
  "deliveredAt" TIMESTAMPTZ(6),
  "readAt" TIMESTAMPTZ(6),
  "deadLetteredAt" TIMESTAMPTZ(6),
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "WhatsappOutboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappInboundMessage_provider_externalMessageId_key" ON "WhatsappInboundMessage"("provider", "externalMessageId");
CREATE INDEX "WhatsappInboundMessage_status_availableAt_createdAt_idx" ON "WhatsappInboundMessage"("status", "availableAt", "createdAt");
CREATE INDEX "WhatsappInboundMessage_phone_createdAt_idx" ON "WhatsappInboundMessage"("phone", "createdAt");
CREATE UNIQUE INDEX "WhatsappInboundMessage_processing_phone_key" ON "WhatsappInboundMessage"("phone") WHERE "status" = 'PROCESSING';

CREATE UNIQUE INDEX "WhatsappOutboxMessage_inboundMessageId_key" ON "WhatsappOutboxMessage"("inboundMessageId");
CREATE UNIQUE INDEX "WhatsappOutboxMessage_providerMessageId_key" ON "WhatsappOutboxMessage"("providerMessageId");
CREATE INDEX "WhatsappOutboxMessage_status_availableAt_createdAt_idx" ON "WhatsappOutboxMessage"("status", "availableAt", "createdAt");
CREATE INDEX "WhatsappOutboxMessage_phone_createdAt_idx" ON "WhatsappOutboxMessage"("phone", "createdAt");

ALTER TABLE "WhatsappOutboxMessage" ADD CONSTRAINT "WhatsappOutboxMessage_inboundMessageId_fkey"
  FOREIGN KEY ("inboundMessageId") REFERENCES "WhatsappInboundMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
