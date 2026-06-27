CREATE TABLE "DinActivityEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID,
  "conversationId" UUID,
  "phone" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sendStatus" TEXT,
  "messageText" TEXT,
  "audioTranscription" TEXT,
  "replyText" TEXT,
  "errorMessage" TEXT,
  "payload" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "DinActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DinActivityEvent_userId_createdAt_idx"
  ON "DinActivityEvent"("userId", "createdAt");

CREATE INDEX "DinActivityEvent_phone_createdAt_idx"
  ON "DinActivityEvent"("phone", "createdAt");

CREATE INDEX "DinActivityEvent_status_createdAt_idx"
  ON "DinActivityEvent"("status", "createdAt");

ALTER TABLE "DinActivityEvent"
  ADD CONSTRAINT "DinActivityEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DinActivityEvent"
  ADD CONSTRAINT "DinActivityEvent_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
