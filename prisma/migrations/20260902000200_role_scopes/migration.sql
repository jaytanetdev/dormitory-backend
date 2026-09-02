CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'STORE', 'BRANCH');
ALTER TABLE "Role" ADD COLUMN "scopeLevel" "RoleScope" NOT NULL DEFAULT 'BRANCH';
UPDATE "Role" SET "scopeLevel" = 'STORE' WHERE "isSystem" = true;
