ALTER TABLE "DinActivityEvent"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "externalMessageId" TEXT,
  ADD COLUMN "detectedIntent" TEXT,
  ADD COLUMN "confidence" DOUBLE PRECISION,
  ADD COLUMN "aiDurationMs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processingDurationMs" INTEGER,
  ADD COLUMN "executedAction" TEXT,
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "promptVersion" TEXT,
  ADD COLUMN "modelVersion" TEXT,
  ADD COLUMN "retentionUntil" TIMESTAMPTZ(6),
  ADD COLUMN "redactedAt" TIMESTAMPTZ(6);

UPDATE "DinActivityEvent"
SET "retentionUntil" = "createdAt" + INTERVAL '30 days'
WHERE "retentionUntil" IS NULL;

CREATE UNIQUE INDEX "DinActivityEvent_provider_externalMessageId_key"
  ON "DinActivityEvent"("provider", "externalMessageId");

CREATE INDEX "DinActivityEvent_retentionUntil_idx"
  ON "DinActivityEvent"("retentionUntil");
