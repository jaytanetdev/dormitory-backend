ALTER TABLE "Branch" ADD COLUMN "lateFeePerDay" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "Receipt" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "lateFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Receipt_paymentId_key" UNIQUE ("paymentId"),
  CONSTRAINT "Receipt_branchId_number_key" UNIQUE ("branchId", "number"),
  CONSTRAINT "Receipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Receipt_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Receipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Receipt_storeId_branchId_issuedAt_idx" ON "Receipt"("storeId", "branchId", "issuedAt");
