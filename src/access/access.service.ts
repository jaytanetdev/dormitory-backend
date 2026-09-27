import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from 'bcrypt';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { assertBranchAccess } from '../common/branch-access';
import { CreateBranchDto, CreateRoleDto, CreateUserDto, UpdateBranchDto, UpdateRolePermissionsDto, UpdateUserDto } from './access.dto';
import { LineCredentialsService } from '../line/line-credentials';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService, private readonly credentials: LineCredentialsService, private readonly config: ConfigService) {}
  async listBranches(user: RequestUser) {
    const branches = await this.prisma.branch.findMany({
      where: { storeId: user.storeId, deletedAt: null, ...(user.allBranches ? {} : { id: { in: user.branchIds } }) },
      include: { lineIntegration: { select: { id: true, displayName: true, miniAppChannelId: true, messagingChannelId: true, liffId: true, isActive: true, updatedAt: true } } }, orderBy: { name: 'asc' }
    });
    const appUrl = this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/$/, '');
    return branches.map((branch) => ({ ...branch, residentClaimUrl: branch.lineIntegration ? `https://miniapp.line.me/${encodeURIComponent(branch.lineIntegration.liffId)}/claim/branch/${encodeURIComponent(branch.claimCode)}?liffId=${encodeURIComponent(branch.lineIntegration.liffId)}` : null }));
  }
  async createBranch(user: RequestUser, dto: CreateBranchDto) {
    const accessToken = dto.lineMessagingAccessToken ?? dto.lineChannelAccessToken;
    const messagingSecret = dto.lineMessagingSecret ?? dto.lineMessagingChannelSecret ?? dto.lineChannelSecret;
    const miniAppSecret = dto.lineMiniAppChannelSecret ?? dto.lineChannelSecret;
    const miniAppChannelId = dto.lineMiniAppChannelId ?? dto.lineLoginChannelId;
    if (!accessToken || !messagingSecret || !miniAppSecret || !miniAppChannelId || !dto.lineMessagingChannelId) throw new BadRequestException('LINE Mini App and Messaging API credentials are required');
    const requiredAccessToken = accessToken;
    const requiredMessagingSecret = messagingSecret;
    const requiredMiniAppSecret = miniAppSecret;
    const requiredMiniAppChannelId = miniAppChannelId;
    const requiredMessagingChannelId = dto.lineMessagingChannelId;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const branch = await tx.branch.create({ data: {
          storeId: user.storeId, name: dto.name, code: dto.code.toUpperCase(), address: dto.address, phone: dto.phone,
      lineIntegration: { create: { displayName: dto.lineDisplayName, channelAccessTokenEncrypted: this.credentials.encrypt(requiredAccessToken), miniAppChannelSecretEncrypted: this.credentials.encrypt(requiredMiniAppSecret), miniAppChannelId: requiredMiniAppChannelId, messagingChannelSecretEncrypted: this.credentials.encrypt(requiredMessagingSecret), messagingChannelId: requiredMessagingChannelId, liffId: dto.lineLiffId } }
        }, include: { lineIntegration: { select: { id: true, displayName: true, miniAppChannelId: true, messagingChannelId: true, liffId: true, isActive: true, updatedAt: true } } } });
        await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'branch.create', entityType: 'Branch', entityId: branch.id, metadata: { code: branch.code, lineIntegrationId: branch.lineIntegration?.id } } });
        const appUrl = this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/$/, '');
        return { ...branch, residentClaimUrl: branch.lineIntegration ? `https://miniapp.line.me/${encodeURIComponent(branch.lineIntegration.liffId)}/claim/branch/${encodeURIComponent(branch.claimCode)}?liffId=${encodeURIComponent(branch.lineIntegration.liffId)}` : null };
      });
    }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Branch code already exists'); throw error; }
  }
  async updateBranch(user: RequestUser, id: string, dto: UpdateBranchDto) {
    const branch = await this.prisma.branch.findFirst({ where: { id, storeId: user.storeId, deletedAt: null }, include: { lineIntegration: true } });
    if (!branch) throw new NotFoundException('Branch not found'); assertBranchAccess(user, id);
    const integrationChanged = dto.lineDisplayName !== undefined || dto.lineChannelAccessToken !== undefined || dto.lineMessagingAccessToken !== undefined || dto.lineChannelSecret !== undefined || dto.lineMessagingSecret !== undefined || dto.lineLoginChannelId !== undefined || dto.lineLiffId !== undefined || dto.lineIsActive !== undefined || dto.lineMiniAppChannelId !== undefined || dto.lineMiniAppChannelSecret !== undefined || dto.lineMessagingChannelId !== undefined || dto.lineMessagingChannelSecret !== undefined;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.branch.update({ where: { id }, data: {
        name: dto.name, address: dto.address, phone: dto.phone,
        ...(integrationChanged ? { lineIntegration: { update: { displayName: dto.lineDisplayName, ...((dto.lineMessagingAccessToken ?? dto.lineChannelAccessToken) ? { channelAccessTokenEncrypted: this.credentials.encrypt(dto.lineMessagingAccessToken ?? dto.lineChannelAccessToken!) } : {}), ...(dto.lineMiniAppChannelSecret || dto.lineChannelSecret ? { miniAppChannelSecretEncrypted: this.credentials.encrypt(dto.lineMiniAppChannelSecret ?? dto.lineChannelSecret!) } : {}), ...((dto.lineMessagingSecret ?? dto.lineMessagingChannelSecret ?? dto.lineChannelSecret) ? { messagingChannelSecretEncrypted: this.credentials.encrypt(dto.lineMessagingSecret ?? dto.lineMessagingChannelSecret ?? dto.lineChannelSecret!) } : {}), miniAppChannelId: dto.lineMiniAppChannelId ?? dto.lineLoginChannelId, messagingChannelId: dto.lineMessagingChannelId, liffId: dto.lineLiffId, isActive: dto.lineIsActive, ...((dto.lineMessagingAccessToken ?? dto.lineChannelAccessToken) || dto.lineChannelSecret || dto.lineMiniAppChannelSecret || dto.lineMessagingSecret || dto.lineMessagingChannelSecret ? { credentialVersion: { increment: 1 } } : {}) } } } : {})
      }, include: { lineIntegration: { select: { id: true, displayName: true, miniAppChannelId: true, messagingChannelId: true, liffId: true, isActive: true, updatedAt: true } } } });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'branch.update', entityType: 'Branch', entityId: id, metadata: { lineIntegrationChanged: integrationChanged } } });
      return updated;
    });
  }
  async deleteBranch(user: RequestUser, id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, storeId: user.storeId, deletedAt: null } });
    if (!branch) throw new NotFoundException('Branch not found');
    assertBranchAccess(user, id);
    const [properties, residents, contracts, invoices, payments] = await this.prisma.$transaction([
      this.prisma.property.count({ where: { branchId: id, deletedAt: null } }),
      this.prisma.resident.count({ where: { branchId: id, deletedAt: null } }),
      this.prisma.contract.count({ where: { branchId: id } }),
      this.prisma.invoice.count({ where: { branchId: id } }),
      this.prisma.payment.count({ where: { branchId: id } }),
    ]);
    if (properties || residents || contracts || invoices || payments) {
      throw new ConflictException('ลบสาขานี้ไม่ได้ เพราะมีห้องพัก ผู้เช่า สัญญา หรือประวัติการเงินอยู่แล้ว');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.branch.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'branch.delete', entityType: 'Branch', entityId: id, metadata: { code: branch.code } } });
    });
    return { id, deleted: true };
  }
  async permissionMatrix() {
    const permissions = await this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
    return Object.values(permissions.reduce<Record<string, { module: string; actions: { key: string; action: string; description: string | null }[] }>>((acc, item) => {
      acc[item.module] ??= { module: item.module, actions: [] }; acc[item.module].actions.push({ key: item.key, action: item.action, description: item.description }); return acc;
    }, {}));
  }
  listRoles(user: RequestUser) { return this.prisma.role.findMany({ where: { storeId: user.storeId, deletedAt: null }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } }); }
  createRole(user: RequestUser, dto: CreateRoleDto) { return this.saveRole(user, dto); }
  async updateRolePermissions(user: RequestUser, roleId: string, dto: UpdateRolePermissionsDto) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, storeId: user.storeId, deletedAt: null } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ConflictException('System roles cannot be modified');
    this.assertPermissionSubset(user, dto.permissionKeys);
    return this.prisma.$transaction(async (tx) => {
      const permissions = await tx.permission.findMany({ where: { key: { in: dto.permissionKeys } } });
      if (permissions.length !== dto.permissionKeys.length) throw new BadRequestException('Unknown permission key');
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId, permissionId: permission.id })) });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'role.permissions.update', entityType: 'Role', entityId: roleId, metadata: { permissionKeys: dto.permissionKeys } } });
      return tx.role.findUniqueOrThrow({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
    });
  }
  async listUsers(user: RequestUser) {
    const items = await this.prisma.user.findMany({ where: { storeId: user.storeId, deletedAt: null, ...(user.allBranches ? {} : { allBranches: false, branches: { some: { branchId: { in: user.branchIds } }, every: { branchId: { in: user.branchIds } } } }) }, select: { id: true, email: true, displayName: true, status: true, allBranches: true, isPlatformAdmin: true, role: { select: { id: true, name: true, isSystem: true, scopeLevel: true, permissions: { select: { permission: { select: { key: true } } } } } }, branches: { select: { branch: { select: { id: true, name: true } } } } } });
    return items.map(item => {
      const { permissions, ...role } = item.role;
      const canManage = user.permissions.includes('user.update') && item.id !== user.id && !item.isPlatformAdmin && !role.isSystem && (user.isPlatformAdmin || permissions.every(entry => user.permissions.includes(entry.permission.key)));
      const { isPlatformAdmin: _platform, ...safe } = item;
      return { ...safe, role, canManage };
    });
  }
  async assignableRoles(user: RequestUser) {
    const roles = await this.prisma.role.findMany({ where: { storeId: user.storeId, deletedAt: null, isSystem: false, scopeLevel: { not: 'PLATFORM' } }, include: { permissions: { include: { permission: true } } }, orderBy: { name: 'asc' } });
    return roles.filter(role => user.isPlatformAdmin || role.permissions.every(item => user.permissions.includes(item.permission.key)));
  }
  async updateUser(user: RequestUser, id: string, dto: UpdateUserDto) {
    if (!dto.displayName.trim()) throw new BadRequestException('Display name is required');
    const target = await this.prisma.user.findFirst({ where: { id, storeId: user.storeId, deletedAt: null }, include: { role: { include: { permissions: { include: { permission: true } } } }, branches: true } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === user.id) throw new ConflictException('ไม่สามารถแก้ไขสิทธิ์หรือสถานะบัญชีของตัวเอง');
    if (target.isPlatformAdmin || target.role.isSystem) throw new ConflictException('บัญชีระบบไม่อนุญาตให้แก้ไขจากหน้านี้');
    if (!user.allBranches && (target.allBranches || target.branches.some(branch => !user.branchIds.includes(branch.branchId)))) throw new BadRequestException('Cannot manage a user outside actor scope');
    this.assertPermissionSubset(user, target.role.permissions.map(item => item.permission.key));
    const role = await this.prisma.role.findFirst({ where: { id: dto.roleId, storeId: user.storeId, deletedAt: null }, include: { permissions: { include: { permission: true } } } });
    if (!role || role.isSystem || role.scopeLevel === 'PLATFORM') throw new BadRequestException('Choose an assignable staff role');
    this.assertPermissionSubset(user, role.permissions.map(item => item.permission.key));
    if (dto.allBranches && !user.allBranches) throw new BadRequestException('Cannot grant all-branch access');
    if (!user.allBranches && dto.branchIds.some(branchId => !user.branchIds.includes(branchId))) throw new BadRequestException('Cannot grant a branch outside actor scope');
    const branchCount = await this.prisma.branch.count({ where: { id: { in: dto.branchIds }, storeId: user.storeId, deletedAt: null } });
    if (!dto.allBranches && (!dto.branchIds.length || branchCount !== dto.branchIds.length)) throw new BadRequestException('Invalid branch scope');
    return this.prisma.$transaction(async tx => {
      await tx.userBranch.deleteMany({ where: { userId: id } });
      const updated = await tx.user.update({ where: { id }, data: { displayName: dto.displayName.trim(), roleId: dto.roleId, status: dto.status, allBranches: dto.allBranches, branches: { create: dto.allBranches ? [] : dto.branchIds.map(branchId => ({ branchId })) } }, select: { id: true, email: true, displayName: true, status: true, allBranches: true, role: { select: { id: true, name: true, isSystem: true, scopeLevel: true } }, branches: { select: { branch: { select: { id: true, name: true } } } } } });
      if (dto.status !== 'ACTIVE') await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'user.update', entityType: 'User', entityId: id, metadata: { roleId: dto.roleId, status: dto.status, allBranches: dto.allBranches, branchIds: dto.branchIds } } });
      return updated;
    });
  }
  async createUser(user: RequestUser, dto: CreateUserDto) {
    const [role, branchCount] = await Promise.all([
      this.prisma.role.findFirst({ where: { id: dto.roleId, storeId: user.storeId, deletedAt: null } }),
      this.prisma.branch.count({ where: { id: { in: dto.branchIds }, storeId: user.storeId, deletedAt: null } })
    ]);
    if (!role) throw new BadRequestException('Role does not belong to store');
    if (role.isSystem && !user.isPlatformAdmin) throw new BadRequestException('System roles can only be assigned by a platform administrator');
    if (role.scopeLevel === 'PLATFORM' && !user.isPlatformAdmin) throw new BadRequestException('Platform roles can only be assigned by a platform administrator');
    const rolePermissionKeys = await this.prisma.rolePermission.findMany({ where: { roleId: role.id }, select: { permission: { select: { key: true } } } });
    this.assertPermissionSubset(user, rolePermissionKeys.map((item) => item.permission.key));
    if (dto.allBranches && !user.allBranches) throw new BadRequestException('Cannot grant all-branch access');
    if (!user.allBranches && dto.branchIds.some((id) => !user.branchIds.includes(id))) throw new BadRequestException('Cannot grant a branch outside actor scope');
    if (!dto.allBranches && (dto.branchIds.length === 0 || branchCount !== dto.branchIds.length)) throw new BadRequestException('Invalid branch scope');
    return this.prisma.user.create({ data: { storeId: user.storeId, roleId: dto.roleId, email: dto.email.toLowerCase(), passwordHash: await hash(dto.password, 12), displayName: dto.displayName, status: UserStatus.ACTIVE, allBranches: dto.allBranches, branches: { createMany: { data: dto.allBranches ? [] : dto.branchIds.map((branchId) => ({ branchId })) } } }, select: { id: true, email: true, displayName: true, roleId: true, allBranches: true } });
  }
  private async saveRole(user: RequestUser, dto: CreateRoleDto) {
    this.assertPermissionSubset(user, dto.permissionKeys);
    return this.prisma.$transaction(async (tx) => {
      const permissions = await tx.permission.findMany({ where: { key: { in: dto.permissionKeys } } });
      if (permissions.length !== dto.permissionKeys.length) throw new BadRequestException('Unknown permission key');
      const role = await tx.role.create({ data: { storeId: user.storeId, name: dto.name, description: dto.description, permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } }, include: { permissions: { include: { permission: true } } } });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'role.create', entityType: 'Role', entityId: role.id, metadata: { permissionKeys: dto.permissionKeys } } }); return role;
    });
  }
  private assertPermissionSubset(user: RequestUser, keys: string[]): void {
    if (!user.isPlatformAdmin && keys.some((key) => !user.permissions.includes(key))) throw new BadRequestException('Cannot grant permissions the actor does not hold');
  }
}
