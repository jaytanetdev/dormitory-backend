INSERT INTO "User" ("id", "storeId", "roleId", "email", "passwordHash", "displayName", "status", "allBranches", "isPlatformAdmin", "createdAt", "updatedAt")
SELECT 'system-platform-admin', s."id", r."id", 'platform@demo.local', '$2b$12$a/9FOb0LpwBLnTirZXvpKe0xVEsFf9bjzgKvxRXbE8sbKA2Hn9XZC', 'Platform Super Admin', 'ACTIVE', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Store" s
JOIN "Role" r ON r."storeId" = s."id" AND r."name" = 'SUPER_ADMIN'
WHERE s."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."isPlatformAdmin" = true);
