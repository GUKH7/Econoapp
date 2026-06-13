ALTER TABLE "WhatsappConversation"
  ADD COLUMN "pendingType" TEXT,
  ADD COLUMN "pendingStep" TEXT,
  ADD COLUMN "pendingData" JSONB;
