-- Keep Mini App (LIFF) credentials separate from Messaging API credentials.
ALTER TABLE "LineIntegration" ADD COLUMN "miniAppChannelId" TEXT;
ALTER TABLE "LineIntegration" ADD COLUMN "miniAppChannelSecretEncrypted" TEXT;
ALTER TABLE "LineIntegration" ADD COLUMN "messagingChannelId" TEXT;
ALTER TABLE "LineIntegration" ADD COLUMN "messagingChannelSecretEncrypted" TEXT;

UPDATE "LineIntegration"
SET "miniAppChannelId" = "loginChannelId",
    "miniAppChannelSecretEncrypted" = "channelSecretEncrypted",
    "messagingChannelId" = "loginChannelId",
    "messagingChannelSecretEncrypted" = "channelSecretEncrypted"
WHERE "miniAppChannelId" IS NULL;

ALTER TABLE "LineIntegration" ALTER COLUMN "miniAppChannelId" SET NOT NULL;
ALTER TABLE "LineIntegration" ALTER COLUMN "miniAppChannelSecretEncrypted" SET NOT NULL;
ALTER TABLE "LineIntegration" ALTER COLUMN "messagingChannelId" SET NOT NULL;
ALTER TABLE "LineIntegration" ALTER COLUMN "messagingChannelSecretEncrypted" SET NOT NULL;

ALTER TABLE "LineIntegration" DROP COLUMN "loginChannelId";
ALTER TABLE "LineIntegration" DROP COLUMN "channelSecretEncrypted";
