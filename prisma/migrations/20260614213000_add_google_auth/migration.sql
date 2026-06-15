ALTER TABLE "User"
ALTER COLUMN "passwordHash" DROP NOT NULL,
ADD COLUMN "googleSubject" TEXT;

CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");
