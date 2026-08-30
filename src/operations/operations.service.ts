import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ContractStatus, RoomStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { assertBranchAccess } from '../common/branch-access';
import { CreateBuildingDto, CreateContractDto, CreateInviteDto, CreatePropertyDto, CreateResidentDto, CreateRoomDto, CreateRoomTypeDto } from './operations.dto';

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  properties(user: RequestUser, branchId: string) { assertBranchAccess(user, branchId); return this.prisma.property.findMany({ where: { storeId: user.storeId, branchId, deletedAt: null }, include: { buildings: { where: { deletedAt: null }, include: { rooms: { where: { deletedAt: null }, include: { roomType: true } } } } } }); }
  async createProperty(user: RequestUser, dto: CreatePropertyDto) { assertBranchAccess(user, dto.branchId); await this.assertBranch(user.storeId, dto.branchId); return this.prisma.property.create({ data: { storeId: user.storeId, ...dto } }); }
  async createBuilding(user: RequestUser, propertyId: string, dto: CreateBuildingDto) { const property = await this.assertProperty(user.storeId, propertyId); assertBranchAccess(user, property.branchId); return this.prisma.building.create({ data: { propertyId, name: dto.name } }); }
  roomTypes(user: RequestUser) { return this.prisma.roomType.findMany({ where: { storeId: user.storeId, deletedAt: null } }); }
  createRoomType(user: RequestUser, dto: CreateRoomTypeDto) { return this.prisma.roomType.create({ data: { storeId: user.storeId, ...dto } }); }
  async createRoom(user: RequestUser, buildingId: string, dto: CreateRoomDto) {
    const [building, type] = await Promise.all([this.prisma.building.findFirst({ where: { id: buildingId, deletedAt: null, property: { storeId: user.storeId } } }), this.prisma.roomType.findFirst({ where: { id: dto.roomTypeId, storeId: user.storeId, deletedAt: null } })]);
    if (!building || !type) throw new BadRequestException('Invalid building or room type');
    const property = await this.prisma.property.findUniqueOrThrow({ where: { id: building.propertyId } }); assertBranchAccess(user, property.branchId);
    return this.prisma.room.create({ data: { buildingId, ...dto } });
  }
  async updateRoomStatus(user: RequestUser, roomId: string, status: RoomStatus) { const room = await this.assertRoom(user.storeId, roomId); assertBranchAccess(user, room.building.property.branchId); return this.prisma.room.update({ where: { id: roomId }, data: { status } }); }
  async createRoomInvite(user: RequestUser, roomId: string, dto: CreateInviteDto) {
    const room = await this.assertRoom(user.storeId, roomId);
    const branchId = room.building.property.branchId;
    assertBranchAccess(user, branchId);
    if (room.status !== RoomStatus.VACANT) throw new ConflictException('Only vacant rooms can create an invite');
    const integration = await this.prisma.lineIntegration.findFirst({ where: { branchId, isActive: true }, select: { liffId: true } });
    if (!integration) throw new ConflictException('LINE Mini App is not configured for this branch');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + dto.expiresInHours * 3_600_000);
    const invite = await this.prisma.$transaction(async (tx) => {
      await tx.roomInvite.updateMany({ where: { roomId, status: 'PENDING' }, data: { status: 'REVOKED' } });
      const created = await tx.roomInvite.create({ data: { storeId: user.storeId, roomId, tokenHash: this.hashToken(token), expiresAt } });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'room.invite.create', entityType: 'RoomInvite', entityId: created.id, metadata: { roomId, branchId, expiresAt } } });
      return created;
    });
    const encodedLiffId = encodeURIComponent(integration.liffId);
    return { id: invite.id, roomId, roomNumber: room.number, expiresAt, claimUrl: `https://miniapp.line.me/${encodedLiffId}/claim/${encodeURIComponent(token)}?liffId=${encodedLiffId}` };
  }
  residents(user: RequestUser, branchId: string) { assertBranchAccess(user, branchId); return this.prisma.resident.findMany({ where: { storeId: user.storeId, branchId, deletedAt: null }, include: { lineIdentity: true, contracts: { include: { room: true }, orderBy: { createdAt: 'desc' }, take: 1 } } }); }
  async createResident(user: RequestUser, dto: CreateResidentDto) { assertBranchAccess(user, dto.branchId); await this.assertBranch(user.storeId, dto.branchId); return this.prisma.resident.create({ data: { storeId: user.storeId, ...dto } }); }
  async createContract(user: RequestUser, dto: CreateContractDto) {
    assertBranchAccess(user, dto.branchId);
    const [room, resident] = await Promise.all([this.assertRoom(user.storeId, dto.roomId), this.prisma.resident.findFirst({ where: { id: dto.residentId, storeId: user.storeId, branchId: dto.branchId, deletedAt: null } })]);
    if (!resident || room.building.property.branchId !== dto.branchId) throw new BadRequestException('Room and resident must belong to branch');
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.contract.count({ where: { roomId: dto.roomId, status: ContractStatus.ACTIVE } });
      if (active) throw new ConflictException('Room already has active contract');
      const contract = await tx.contract.create({ data: { storeId: user.storeId, ...dto, startDate: new Date(dto.startDate), endDate: dto.endDate ? new Date(dto.endDate) : undefined, status: ContractStatus.ACTIVE } });
      await tx.room.update({ where: { id: dto.roomId }, data: { status: RoomStatus.OCCUPIED } });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'contract.create', entityType: 'Contract', entityId: contract.id, metadata: { roomId: dto.roomId, residentId: dto.residentId } } });
      return contract;
    });
  }
  contracts(user: RequestUser, branchId: string) { assertBranchAccess(user, branchId); return this.prisma.contract.findMany({ where: { storeId: user.storeId, branchId }, include: { room: true, resident: { include: { lineIdentity: true } } }, orderBy: { createdAt: 'desc' } }); }
  async setContractStatus(user: RequestUser, id: string, status: ContractStatus, endDate?: string) {
    const contract = await this.prisma.contract.findFirst({ where: { id, storeId: user.storeId } }); if (!contract) throw new NotFoundException('Contract not found'); assertBranchAccess(user, contract.branchId);
    const isMoveOut = status === ContractStatus.ENDED || status === ContractStatus.CANCELLED;
    if (isMoveOut && contract.status !== ContractStatus.ACTIVE) throw new ConflictException('Only an active contract can be ended');
    const effectiveEndDate = isMoveOut ? new Date(endDate ?? Date.now()) : undefined;
    if (effectiveEndDate && effectiveEndDate < contract.startDate) throw new BadRequestException('Move-out date cannot be before contract start date');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contract.update({ where: { id }, data: { status, ...(effectiveEndDate ? { endDate: effectiveEndDate } : {}) } });
      if (isMoveOut) await tx.room.update({ where: { id: contract.roomId }, data: { status: RoomStatus.VACANT } });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: isMoveOut ? 'contract.move_out' : 'contract.status.update', entityType: 'Contract', entityId: id, metadata: { status, endDate: effectiveEndDate?.toISOString(), roomId: contract.roomId } } });
      return updated;
    });
  }
  async createInvite(user: RequestUser, contractId: string, dto: CreateInviteDto) {
    const contract = await this.prisma.contract.findFirst({ where: { id: contractId, storeId: user.storeId, status: ContractStatus.ACTIVE } }); if (!contract) throw new NotFoundException('Active contract not found'); assertBranchAccess(user, contract.branchId);
    const token = randomBytes(32).toString('base64url'); const tokenHash = this.hashToken(token); const expiresAt = new Date(Date.now() + dto.expiresInHours * 3_600_000);
    const invite = await this.prisma.roomInvite.create({ data: { storeId: user.storeId, contractId, tokenHash, expiresAt } });
    return { id: invite.id, expiresAt, claimUrl: `${this.config.get('PUBLIC_APP_URL')}/claim/${token}`, token };
  }
  private hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private async assertBranch(storeId: string, id: string) { const value = await this.prisma.branch.findFirst({ where: { id, storeId, deletedAt: null } }); if (!value) throw new NotFoundException('Branch not found'); return value; }
  private async assertProperty(storeId: string, id: string) { const value = await this.prisma.property.findFirst({ where: { id, storeId, deletedAt: null } }); if (!value) throw new NotFoundException('Property not found'); return value; }
  private async assertRoom(storeId: string, id: string) { const value = await this.prisma.room.findFirst({ where: { id, deletedAt: null, building: { property: { storeId, deletedAt: null } } }, include: { building: { include: { property: true } } } }); if (!value) throw new NotFoundException('Room not found'); return value; }
}
