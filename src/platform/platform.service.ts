import { ConflictException, Injectable } from '@nestjs/common';
import { hash } from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { CreateStoreDto } from './platform.dto';
@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}
  listStores() { return this.prisma.store.findMany({ where: { deletedAt: null }, include: { _count: { select: { branches: true, users: true, invoices: true } }, branches: { where: { deletedAt: null }, select: { id: true, name: true, code: true } } }, orderBy: { createdAt: 'desc' } }); }
  async createStore(actor: RequestUser, dto: CreateStoreDto) {
    try { return await this.prisma.$transaction(async (tx) => {
      const permissions = await tx.permission.findMany(); const store = await tx.store.create({ data: { name: dto.name, slug: dto.slug } });
      const branch = await tx.branch.create({ data: { storeId: store.id, name: dto.branchName, code: dto.branchCode.toUpperCase() } });
      const role = await tx.role.create({ data: { storeId: store.id, name: 'Owner', description: 'System owner role', isSystem: true, permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } } });
      const owner = await tx.user.create({ data: { storeId: store.id, roleId: role.id, email: dto.ownerEmail.toLowerCase(), displayName: dto.ownerName, passwordHash: await hash(dto.ownerPassword, 12), allBranches: true } });
      await tx.auditLog.create({ data: { storeId: store.id, actorUserId: actor.id, action: 'platform.store.create', entityType: 'Store', entityId: store.id, metadata: { ownerId: owner.id, branchId: branch.id } } });
      return { store, branch, owner: { id: owner.id, email: owner.email, displayName: owner.displayName } };
    }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Store slug or owner already exists'); throw error; }
  }
}
