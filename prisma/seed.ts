import { PrismaClient, PromptPayType } from '@prisma/client';
import { hash } from 'bcrypt';
import { createCipheriv, randomBytes } from 'crypto';

const prisma = new PrismaClient();
function encryptSeedCredential(value: string): string {
  const encodedKey = process.env.LINE_CREDENTIAL_ENCRYPTION_KEY;
  if (!encodedKey) throw new Error('LINE_CREDENTIAL_ENCRYPTION_KEY is required to seed LINE integrations');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new Error('LINE_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}
const modules: Record<string, string[]> = {
  branch: ['view', 'create', 'update'], role: ['view', 'create', 'update', 'delete'], user: ['view', 'create', 'update', 'delete'],
  property: ['view', 'create', 'update', 'delete'], room: ['view', 'create', 'update', 'delete', 'transfer'], resident: ['view', 'create', 'update', 'delete'],
  contract: ['view', 'create', 'update', 'delete', 'invite'], meter: ['view', 'create', 'update'], invoice: ['view', 'create', 'update', 'issue', 'void'],
  payment: ['view', 'create', 'approve'], notification: ['send'], settings: ['view', 'update'], report: ['view', 'export']
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') throw new Error('Refusing to seed production without ALLOW_PRODUCTION_SEED=true');
  const permissionRows = Object.entries(modules).flatMap(([module, actions]) => actions.map((action) => ({ key: `${module}.${action}`, module, action, description: `${action} ${module}` })));
  for (const row of permissionRows) await prisma.permission.upsert({ where: { key: row.key }, create: row, update: row });
  const store = await prisma.store.upsert({ where: { slug: 'demo-store' }, create: { name: 'หอพักเดโม', slug: 'demo-store' }, update: { name: 'หอพักเดโม' } });
  const branch = await prisma.branch.upsert({ where: { storeId_code: { storeId: store.id, code: 'MAIN' } }, create: { storeId: store.id, name: 'สาขาหลัก', code: 'MAIN', address: 'กรุงเทพมหานคร' }, update: {} });
  const accessToken = process.env.SEED_LINE_CHANNEL_ACCESS_TOKEN ?? 'seed-local-access-token';
  const channelSecret = process.env.SEED_LINE_CHANNEL_SECRET ?? 'seed-local-channel-secret';
  await prisma.lineIntegration.upsert({ where: { branchId: branch.id }, create: { branchId: branch.id, displayName: 'Demo LINE OA', channelAccessTokenEncrypted: encryptSeedCredential(accessToken), channelSecretEncrypted: encryptSeedCredential(channelSecret), loginChannelId: process.env.SEED_LINE_LOGIN_CHANNEL_ID ?? 'demo-login-channel-id', liffId: process.env.SEED_LINE_LIFF_ID ?? 'demo-liff-id' }, update: {} });
  const role = await prisma.role.upsert({ where: { storeId_name: { storeId: store.id, name: 'Owner' } }, create: { storeId: store.id, name: 'Owner', isSystem: true }, update: {} });
  const permissions = await prisma.permission.findMany();
  await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })), skipDuplicates: true });
  const owner = await prisma.user.upsert({ where: { storeId_email: { storeId: store.id, email: 'owner@demo.local' } }, create: { storeId: store.id, roleId: role.id, email: 'owner@demo.local', passwordHash: await hash('Dormitory123!', 12), displayName: 'เจ้าของหอพักเดโม', allBranches: true }, update: { roleId: role.id, allBranches: true } });
  await prisma.user.upsert({ where: { storeId_email: { storeId: store.id, email: 'platform@demo.local' } }, create: { storeId: store.id, roleId: role.id, email: 'platform@demo.local', passwordHash: await hash('Platform123!', 12), displayName: 'Platform Super Admin', allBranches: true, isPlatformAdmin: true }, update: { roleId: role.id, allBranches: true, isPlatformAdmin: true } });
  await prisma.promptPaySetting.upsert({ where: { branchId: branch.id }, create: { branchId: branch.id, type: PromptPayType.PHONE, target: '0812345678', accountName: 'บัญชีเดโม' }, update: {} });
  console.info(`Seeded store=${store.slug}, branch=${branch.code}, owner=${owner.email}`);
}
main().finally(async () => prisma.$disconnect());
