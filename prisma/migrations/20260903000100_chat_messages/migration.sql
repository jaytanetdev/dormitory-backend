CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "lineIdentityId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "lineMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessage_lineIdentityId_createdAt_idx" ON "ChatMessage"("lineIdentityId", "createdAt");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_lineIdentityId_fkey" FOREIGN KEY ("lineIdentityId") REFERENCES "LineIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
