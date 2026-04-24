ALTER TABLE "Transaction" ADD COLUMN "whatsappMessageId" TEXT;
CREATE UNIQUE INDEX "Transaction_whatsappMessageId_key" ON "Transaction"("whatsappMessageId");
