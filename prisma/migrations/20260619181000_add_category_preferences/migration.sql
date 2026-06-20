CREATE TABLE "CategoryPreference" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceText" TEXT NOT NULL,
  "categoryName" TEXT NOT NULL,
  "type" "TransactionType" NOT NULL,
  "hits" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CategoryPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CategoryPreference_userId_sourceKey_type_key"
  ON "CategoryPreference"("userId", "sourceKey", "type");

CREATE INDEX "CategoryPreference_userId_type_idx"
  ON "CategoryPreference"("userId", "type");

ALTER TABLE "CategoryPreference"
  ADD CONSTRAINT "CategoryPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
