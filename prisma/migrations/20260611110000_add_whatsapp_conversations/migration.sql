CREATE TABLE "WhatsappConversation" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "phone" TEXT NOT NULL,
  "recentMessages" JSONB NOT NULL DEFAULT '[]',
  "pendingText" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "WhatsappConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappConversation_userId_key"
  ON "WhatsappConversation"("userId");

CREATE UNIQUE INDEX "WhatsappConversation_phone_key"
  ON "WhatsappConversation"("phone");

CREATE INDEX "WhatsappConversation_phone_idx"
  ON "WhatsappConversation"("phone");

ALTER TABLE "WhatsappConversation"
  ADD CONSTRAINT "WhatsappConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
