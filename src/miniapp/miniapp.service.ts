import { ConflictException, GoneException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { ContractStatus, InvoiceStatus, PaymentStatus, RoomStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ResidentUser } from '../common/request-user';
import { MiniPaymentDto } from './miniapp.dto';
import { ClaimBranchRoomDto } from './miniapp.dto';
import { LineService } from '../line/line.service';
import QRCode from 'qrcode';
import { generatePromptPayPayload } from '../payments/promptpay';
type UploadedSlip = { buffer: Buffer; mimetype: string; originalname: string; size: number };
@Injectable()
export class MiniappService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly jwt: JwtService, private readonly line: LineService) {}
  async authenticate(idToken: string) {
    const mockLineId = this.mockLineId(idToken);
    const identity = mockLineId
      ? await this.prisma.lineIdentity.findUnique({ where: { lineUserId: mockLineId }, include: { resident: true } })
      : await this.findIdentityByVerifiedToken(idToken);
    if (!identity || identity.resident.deletedAt || !identity.lineIntegrationId) throw new UnauthorizedException('LINE account is not linked');
    return this.issue(identity.resident, identity.lineUserId);
  }
  async branchClaimInfo(claimCode: string) {
    const branch = await this.prisma.branch.findFirst({ where: { claimCode, deletedAt: null, lineIntegration: { isActive: true } }, select: { name: true, address: true, phone: true, lineIntegration: { select: { liffId: true, displayName: true } } } });
    if (!branch) throw new NotFoundException('Branch claim link not found');
    return { branch: { name: branch.name, address: branch.address, phone: branch.phone }, line: branch.lineIntegration };
  }
  async claimBranchRoom(claimCode: string, dto: ClaimBranchRoomDto) {
    const branch = await this.prisma.branch.findFirst({ where: { claimCode, deletedAt: null }, include: { lineIntegration: true } });
    if (!branch?.lineIntegration?.isActive) throw new NotFoundException('Branch claim link not found');
    const integration = branch.lineIntegration;
    const line = await this.line.verifyIdToken(integration.id, dto.idToken);
    return this.prisma.$transaction(async (tx) => {
      const rooms = await tx.room.findMany({ where: { number: dto.roomNumber.trim(), deletedAt: null, status: RoomStatus.VACANT, building: { deletedAt: null, property: { storeId: branch.storeId, branchId: branch.id, deletedAt: null } } }, include: { building: { include: { property: true } } } });
      if (rooms.length === 0) throw new NotFoundException('Vacant room not found in this branch');
      if (rooms.length > 1) throw new ConflictException('Room number is duplicated in this branch; contact staff');
      const existingIdentity = await tx.lineIdentity.findUnique({ where: { lineUserId: line.sub }, include: { resident: { include: { contracts: { where: { status: ContractStatus.ACTIVE }, select: { id: true } } } } } });
      if (existingIdentity?.resident.contracts.length) throw new ConflictException('This LINE account already has an active room');
      const resident = await tx.resident.create({ data: { storeId: branch.storeId, branchId: branch.id, fullName: dto.fullName.trim(), phone: dto.phone?.trim(), email: dto.email?.trim() } });
      const room = rooms[0];
      const contract = await tx.contract.create({ data: { storeId: branch.storeId, branchId: branch.id, roomId: room.id, residentId: resident.id, startDate: new Date(), monthlyRent: room.monthlyRent, deposit: 0, billingDay: 1, status: ContractStatus.ACTIVE } });
      await tx.room.update({ where: { id: room.id }, data: { status: RoomStatus.OCCUPIED } });
      const identity = await tx.lineIdentity.upsert({ where: { lineUserId: line.sub }, create: { residentId: resident.id, lineUserId: line.sub, displayName: line.name, pictureUrl: line.picture, lineIntegrationId: integration.id }, update: { residentId: resident.id, displayName: line.name, pictureUrl: line.picture, lineIntegrationId: integration.id, linkedAt: new Date() } });
      await tx.auditLog.create({ data: { storeId: branch.storeId, action: 'resident.branch_claim', entityType: 'Contract', entityId: contract.id, metadata: { branchId: branch.id, roomId: room.id, residentId: resident.id } } });
      return { ...(await this.issue(resident, identity.lineUserId)), resident: { id: resident.id, fullName: resident.fullName }, room: { id: room.id, number: room.number }, branch: { id: branch.id, name: branch.name } };
    });
  }
  async invite(token: string) { const invite = await this.findInvite(token); return { expiresAt: invite.expiresAt, room: { number: invite.contract.room.number }, property: { name: invite.contract.room.building.property.name }, residentHint: invite.contract.resident.fullName.replace(/.(?=.{2})/g, '*') }; }
  async claim(token: string, idToken: string) {
    const invite = await this.findInvite(token); const integration = await this.integrationForBranch(invite.contract.branchId); const line = await this.line.verifyIdToken(integration.id, idToken);
    const identity = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.roomInvite.updateMany({ where: { id: invite.id, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'CLAIMED', claimedAt: new Date() } }); if (claimed.count !== 1) throw new GoneException('Invite already claimed or expired');
      return tx.lineIdentity.upsert({ where: { residentId: invite.contract.residentId }, create: { residentId: invite.contract.residentId, lineUserId: line.sub, displayName: line.name, pictureUrl: line.picture, lineIntegrationId: integration.id }, update: { lineUserId: line.sub, displayName: line.name, pictureUrl: line.picture, lineIntegrationId: integration.id, linkedAt: new Date() } });
    });
    return { ...(await this.issue(invite.contract.resident, identity.lineUserId)), resident: { id: invite.contract.resident.id, fullName: invite.contract.resident.fullName }, room: { id: invite.contract.room.id, number: invite.contract.room.number } };
  }
  me(user: ResidentUser) { return this.prisma.resident.findFirstOrThrow({ where: { id: user.residentId, storeId: user.storeId, branchId: user.branchId }, select: { id: true, fullName: true, phone: true, email: true, branch: { select: { id: true, name: true } }, contracts: { where: { status: 'ACTIVE' }, select: { id: true, startDate: true, monthlyRent: true, room: { select: { id: true, number: true, building: { select: { name: true, property: { select: { name: true } } } } } } } } } }); }
  invoices(user: ResidentUser) { return this.prisma.invoice.findMany({ where: { storeId: user.storeId, branchId: user.branchId, contract: { residentId: user.residentId } }, select: { id: true, number: true, status: true, total: true, dueDate: true, issuedAt: true, paidAt: true, room: { select: { number: true } }, period: { select: { year: true, month: true } }, payments: { where: { status: 'APPROVED' }, select: { amount: true } } }, orderBy: { dueDate: 'desc' } }); }
  invoice(user: ResidentUser, id: string) { return this.prisma.invoice.findFirstOrThrow({ where: { id, storeId: user.storeId, branchId: user.branchId, contract: { residentId: user.residentId } }, include: { items: true, room: { select: { number: true } }, period: true, payments: { include: { slip: true } } } }); }
  async paymentQr(user: ResidentUser, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, storeId: user.storeId, branchId: user.branchId, contract: { residentId: user.residentId }, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] } },
      include: { branch: { include: { promptPaySetting: true } }, payments: { where: { status: PaymentStatus.APPROVED }, select: { amount: true } } }
    });
    if (!invoice) throw new NotFoundException('Payable invoice not found');
    const setting = invoice.branch.promptPaySetting;
    if (!setting?.enabled) throw new NotFoundException('PromptPay is not configured for this branch');
    const approvedAmount = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const amount = Math.max(0, Number(invoice.total) - approvedAmount);
    if (amount <= 0) throw new ConflictException('Invoice has no outstanding balance');
    const payload = generatePromptPayPayload(setting.type, setting.target, amount);
    return { invoiceId: invoice.id, amount, accountName: setting.accountName, qrDataUrl: await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 480 }) };
  }
  async payment(user: ResidentUser, dto: MiniPaymentDto) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: dto.invoiceId, storeId: user.storeId, branchId: user.branchId, contract: { residentId: user.residentId }, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] } }, include: { payments: { where: { status: PaymentStatus.APPROVED } } } }); if (!invoice) throw new NotFoundException('Payable invoice not found');
    const approved = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0); const outstanding = Math.max(0, Number(invoice.total) - approved); if (dto.amount > outstanding) throw new ConflictException('Payment exceeds outstanding balance');
    return this.prisma.payment.create({ data: { storeId: user.storeId, branchId: user.branchId, invoiceId: invoice.id, amount: dto.amount, paidAt: new Date(dto.paidAt), slip: { create: { fileUrl: dto.fileUrl, fileName: dto.fileName, mimeType: dto.mimeType, size: dto.size } } }, include: { slip: true } });
  }
  async uploadSlip(user: ResidentUser, file: UploadedSlip | undefined, body: { invoiceId: string; amount: string; paidAt: string }) {
    if (!file) throw new NotFoundException('Slip image is required');
    const fileUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    return this.payment(user, { invoiceId: body.invoiceId, amount: Number(body.amount), paidAt: body.paidAt, fileUrl, fileName: file.originalname, mimeType: file.mimetype, size: file.size });
  }
  private async issue(resident: { id: string; storeId: string; branchId: string }, lineUserId: string) { return { accessToken: await this.jwt.signAsync({ sub: resident.id, storeId: resident.storeId, branchId: resident.branchId, lineUserId, type: 'resident' }, { secret: this.config.getOrThrow('JWT_RESIDENT_SECRET'), expiresIn: 3600 }), expiresInSeconds: 3600 }; }
  private async findInvite(token: string) { const invite = await this.prisma.roomInvite.findUnique({ where: { tokenHash: createHash('sha256').update(token).digest('hex') }, include: { contract: { include: { resident: true, room: { include: { building: { include: { property: true } } } } } } } }); if (!invite || invite.status !== 'PENDING' || invite.expiresAt <= new Date()) throw new GoneException('Invite invalid or expired'); return invite; }
  private async integrationForBranch(branchId: string) { const integration = await this.prisma.lineIntegration.findFirst({ where: { branchId, isActive: true } }); if (!integration) throw new NotFoundException('LINE integration is not configured for branch'); return integration; }
  private mockLineId(idToken: string): string | undefined { return this.config.get('NODE_ENV') !== 'production' && idToken.startsWith('mock-line:') ? idToken.slice(10) : undefined; }
  private async findIdentityByVerifiedToken(idToken: string) {
    const identities = await this.prisma.lineIdentity.findMany({ where: { lineIntegrationId: { not: null } }, include: { resident: true } });
    for (const identity of identities) {
      if (!identity.lineIntegrationId) continue;
      try { const verified = await this.line.verifyIdToken(identity.lineIntegrationId, idToken); if (verified.sub === identity.lineUserId) return identity; } catch { /* try another configured integration */ }
    }
    return null;
  }
}
