CREATE TYPE "ScheduledNotificationType" AS ENUM (
  'BILL_DUE',
  'INSTALLMENT_DUE',
  'CREDIT_CARD_DUE'
);

CREATE TABLE "ScheduledNotificationDelivery" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "type" "ScheduledNotificationType" NOT NULL,
  "notificationKey" TEXT NOT NULL,
  "dueDate" TIMESTAMPTZ(6) NOT NULL,
  "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ScheduledNotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduledNotificationDelivery_notificationKey_key"
  ON "ScheduledNotificationDelivery"("notificationKey");

CREATE INDEX "ScheduledNotificationDelivery_userId_dueDate_idx"
  ON "ScheduledNotificationDelivery"("userId", "dueDate");

CREATE INDEX "ScheduledNotificationDelivery_type_dueDate_idx"
  ON "ScheduledNotificationDelivery"("type", "dueDate");

ALTER TABLE "ScheduledNotificationDelivery"
  ADD CONSTRAINT "ScheduledNotificationDelivery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
