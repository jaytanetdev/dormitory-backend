-- Branch-specific LINE credentials and a public, unguessable resident-claim link.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "Branch" ADD COLUMN "claimCode" TEXT;
UPDATE "Branch" SET "claimCode" = gen_random_uuid()::text WHERE "claimCode" IS NULL;
ALTER TABLE "Branch" ALTER COLUMN "claimCode" SET NOT NULL;
ALTER TABLE "Branch" ALTER COLUMN "claimCode" SET DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX "Branch_claimCode_key" ON "Branch"("claimCode");

CREATE TABLE "LineIntegration" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "channelAccessTokenEncrypted" TEXT NOT NULL,
  "channelSecretEncrypted" TEXT NOT NULL,
  "loginChannelId" TEXT NOT NULL,
  "liffId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LineIntegration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LineIntegration_branchId_key" ON "LineIntegration"("branchId");
CREATE INDEX "LineIntegration_isActive_idx" ON "LineIntegration"("isActive");
ALTER TABLE "LineIntegration" ADD CONSTRAINT "LineIntegration_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineIdentity" ADD COLUMN "lineIntegrationId" TEXT;
CREATE INDEX "LineIdentity_lineIntegrationId_idx" ON "LineIdentity"("lineIntegrationId");
ALTER TABLE "LineIdentity" ADD CONSTRAINT "LineIdentity_lineIntegrationId_fkey" FOREIGN KEY ("lineIntegrationId") REFERENCES "LineIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
