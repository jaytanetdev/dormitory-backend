INSERT INTO "Role" ("id", "storeId", "name", "description", "isSystem", "scopeLevel", "createdAt", "updatedAt")
SELECT 'system-super-admin-' || "id", "id", 'SUPER_ADMIN', 'Platform-wide administrator; cannot be edited from Backoffice', true, 'PLATFORM', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Store"
WHERE NOT EXISTS (
  SELECT 1 FROM "Role" r WHERE r."storeId" = "Store"."id" AND r."name" = 'SUPER_ADMIN'
);

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );

UPDATE "User" u
SET "roleId" = r."id", "allBranches" = true, "isPlatformAdmin" = true, "updatedAt" = CURRENT_TIMESTAMP
FROM "Role" r
WHERE u."isPlatformAdmin" = true
  AND r."storeId" = u."storeId"
  AND r."name" = 'SUPER_ADMIN';
