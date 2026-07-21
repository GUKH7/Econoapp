ALTER TYPE "TransactionSource" ADD VALUE IF NOT EXISTS 'RECEIPT';

CREATE TYPE "DinInsightType" AS ENUM (
  'ANOMALOUS_EXPENSE',
  'BALANCE_FORECAST',
  'RECEIVABLE_REMINDER',
  'PAYABLE_REMINDER'
);

CREATE TYPE "DinInsightStatus" AS ENUM (
  'ACTIVE',
  'REMINDED',
  'ACTED',
  'DISMISSED',
  'EXPIRED'
);

CREATE TABLE "AssistantPreference" (
  "userId" UUID NOT NULL,
  "audioRepliesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "proactiveAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "anomalyAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "forecastAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "quietHoursStart" INTEGER NOT NULL DEFAULT 22,
  "quietHoursEnd" INTEGER NOT NULL DEFAULT 8,
  "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "maxWeeklyAlerts" INTEGER NOT NULL DEFAULT 3,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "AssistantPreference_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "DinInsight" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "type" "DinInsightType" NOT NULL,
  "status" "DinInsightStatus" NOT NULL DEFAULT 'ACTIVE',
  "fingerprint" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "explanation" JSONB NOT NULL,
  "metadata" JSONB NOT NULL,
  "suggestedAction" TEXT,
  "actionPayload" JSONB,
  "remindAt" TIMESTAMPTZ(6),
  "lastNotifiedAt" TIMESTAMPTZ(6),
  "actedAt" TIMESTAMPTZ(6),
  "dismissedAt" TIMESTAMPTZ(6),
  "expiresAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DinInsight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DinInsight_fingerprint_key" ON "DinInsight"("fingerprint");
CREATE INDEX "DinInsight_userId_status_createdAt_idx" ON "DinInsight"("userId", "status", "createdAt");
CREATE INDEX "DinInsight_status_remindAt_idx" ON "DinInsight"("status", "remindAt");
CREATE INDEX "DinInsight_userId_lastNotifiedAt_idx" ON "DinInsight"("userId", "lastNotifiedAt");

ALTER TABLE "AssistantPreference"
  ADD CONSTRAINT "AssistantPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DinInsight"
  ADD CONSTRAINT "DinInsight_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
