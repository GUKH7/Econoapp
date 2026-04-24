-- AlterTable: SalesChannel.feePercent DOUBLE PRECISION -> DECIMAL(15,4)
ALTER TABLE "SalesChannel" ALTER COLUMN "feePercent" TYPE DECIMAL(15,4);

-- AlterTable: Transaction.amount DOUBLE PRECISION -> DECIMAL(15,4)
ALTER TABLE "Transaction" ALTER COLUMN "amount" TYPE DECIMAL(15,4);

-- AlterTable: Transaction.netAmount DOUBLE PRECISION -> DECIMAL(15,4)
ALTER TABLE "Transaction" ALTER COLUMN "netAmount" TYPE DECIMAL(15,4);
