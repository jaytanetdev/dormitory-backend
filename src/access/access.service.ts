import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from 'bcrypt';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { assertBranchAccess } from '../common/branch-access';
import { CreateBranchDto, CreateRoleDto, CreateUserDto, UpdateBranchDto, UpdateRolePermissionsDto } from './access.dto';
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
    return branches.map((branch) => ({ ...branch, residentClaimUrl: branch.lineIntegration ? `${appUrl}/claim/${branch.claimCode}?liffId=${encodeURIComponent(branch.lineIntegration.liffId)}` : null }));
  }
  async createBranch(user: RequestUser, dto: CreateBranchDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const branch = await tx.branch.create({ data: {
          storeId: user.storeId, name: dto.name, code: dto.code.toUpperCase(), address: dto.address, phone: dto.phone,
      lineIntegration: { create: { displayName: dto.lineDisplayName, channelAccessTokenEncrypted: this.credentials.encrypt(dto.lineChannelAccessToken), miniAppChannelSecretEncrypted: this.credentials.encrypt(dto.lineMiniAppChannelSecret ?? dto.lineChannelSecret), miniAppChannelId: dto.lineMiniAppChannelId ?? dto.lineLoginChannelId, messagingChannelSecretEncrypted: this.credentials.encrypt(dto.lineMessagingChannelSecret ?? dto.lineChannelSecret), messagingChannelId: dto.lineMessagingChannelId ?? dto.lineLoginChannelId, liffId: dto.lineLiffId } }
        }, include: { lineIntegration: { select: { id: true, displayName: true, miniAppChannelId: true, messagingChannelId: true, liffId: true, isActive: true, updatedAt: true } } } });
        await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'branch.create', entityType: 'Branch', entityId: branch.id, metadata: { code: branch.code, lineIntegrationId: branch.lineIntegration?.id } } });
        const appUrl = this.config.getOrThrow<string>('PUBLIC_APP_URL').replace(/\/$/, '');
        return { ...branch, residentClaimUrl: `${appUrl}/claim/${branch.claimCode}?liffId=${encodeURIComponent(branch.lineIntegration?.liffId ?? '')}` };
      });
    }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Branch code already exists'); throw error; }
  }
  async updateBranch(user: RequestUser, id: string, dto: UpdateBranchDto) {
    const branch = await this.prisma.branch.findFirst({ where: { id, storeId: user.storeId, deletedAt: null }, include: { lineIntegration: true } });
    if (!branch) throw new NotFoundException('Branch not found'); assertBranchAccess(user, id);
    const integrationChanged = dto.lineDisplayName !== undefined || dto.lineChannelAccessToken !== undefined || dto.lineChannelSecret !== undefined || dto.lineLoginChannelId !== undefined || dto.lineLiffId !== undefined || dto.lineIsActive !== undefined || dto.lineMiniAppChannelId !== undefined || dto.lineMiniAppChannelSecret !== undefined || dto.lineMessagingChannelId !== undefined || dto.lineMessagingChannelSecret !== undefined;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.branch.update({ where: { id }, data: {
        name: dto.name, address: dto.address, phone: dto.phone,
        ...(integrationChanged ? { lineIntegration: { update: { displayName: dto.lineDisplayName, ...(dto.lineChannelAccessToken ? { channelAccessTokenEncrypted: this.credentials.encrypt(dto.lineChannelAccessToken) } : {}), ...(dto.lineMiniAppChannelSecret || dto.lineChannelSecret ? { miniAppChannelSecretEncrypted: this.credentials.encrypt(dto.lineMiniAppChannelSecret ?? dto.lineChannelSecret!) } : {}), ...(dto.lineMessagingChannelSecret || dto.lineChannelSecret ? { messagingChannelSecretEncrypted: this.credentials.encrypt(dto.lineMessagingChannelSecret ?? dto.lineChannelSecret!) } : {}), miniAppChannelId: dto.lineMiniAppChannelId ?? dto.lineLoginChannelId, messagingChannelId: dto.lineMessagingChannelId, liffId: dto.lineLiffId, isActive: dto.lineIsActive, ...(dto.lineChannelAccessToken || dto.lineChannelSecret || dto.lineMiniAppChannelSecret || dto.lineMessagingChannelSecret ? { credentialVersion: { increment: 1 } } : {}) } } } : {})
      }, include: { lineIntegration: { select: { id: true, displayName: true, miniAppChannelId: true, messagingChannelId: true, liffId: true, isActive: true, updatedAt: true } } } });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'branch.update', entityType: 'Branch', entityId: id, metadata: { lineIntegrationChanged: integrationChanged } } });
      return updated;
    });
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
  listUsers(user: RequestUser) { return this.prisma.user.findMany({ where: { storeId: user.storeId, deletedAt: null }, select: { id: true, email: true, displayName: true, status: true, allBranches: true, role: { select: { id: true, name: true } }, branches: { select: { branch: { select: { id: true, name: true } } } } } }); }
  async createUser(user: RequestUser, dto: CreateUserDto) {
    const [role, branchCount] = await Promise.all([
      this.prisma.role.findFirst({ where: { id: dto.roleId, storeId: user.storeId, deletedAt: null } }),
      this.prisma.branch.count({ where: { id: { in: dto.branchIds }, storeId: user.storeId, deletedAt: null } })
    ]);
    if (!role) throw new BadRequestException('Role does not belong to store');
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
