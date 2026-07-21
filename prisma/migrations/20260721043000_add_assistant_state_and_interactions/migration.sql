ALTER TABLE "WhatsappConversation"
  ADD COLUMN "stateVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "appRecentMessages" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "appPendingText" TEXT,
  ADD COLUMN "appPendingType" TEXT,
  ADD COLUMN "appPendingStep" TEXT,
  ADD COLUMN "appPendingData" JSONB,
  ADD COLUMN "appStateVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WhatsappOutboxMessage"
  ADD COLUMN "interactions" JSONB;
