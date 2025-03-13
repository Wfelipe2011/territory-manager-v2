-- CreateTable
CREATE TABLE "paypal_transaction" (
    "id" SERIAL NOT NULL,
    "transactionId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "feeAmount" DOUBLE PRECISION NOT NULL,
    "netAmount" DOUBLE PRECISION NOT NULL,
    "balanceAfterTransaction" DOUBLE PRECISION,
    "emailFrom" TEXT,
    "name" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "shippingAmount" DOUBLE PRECISION,
    "salesTax" DOUBLE PRECISION,
    "invoiceId" TEXT,
    "referenceTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paypal_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paypal_transaction_id_key" ON "paypal_transaction"("id");

-- CreateIndex
CREATE UNIQUE INDEX "paypal_transaction_transactionId_key" ON "paypal_transaction"("transactionId");
