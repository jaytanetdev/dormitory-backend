import { BadGatewayException, BadRequestException, ConflictException, GoneException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { ContractStatus, InvoiceStatus, PaymentStatus, RoomStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ResidentUser } from '../common/request-user';
import { ClaimBranchRoomDto, ClaimRoomInviteDto, MiniPaymentDto } from './miniapp.dto';
import { LineService } from '../line/line.service';
import QRCode from 'qrcode';
import { generatePromptPayPayload } from '../payments/promptpay';
type UploadedSlip = { buffer: Buffer; mimetype: string; originalname: string; size: number };
@Injectable()
export class MiniappService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly jwt: JwtService, private readonly line: LineService) {}
  async authenticate(idToken: string, liffId?: string) {
    if (liffId) {
      const integration = await this.prisma.lineIntegration.findFirst({ where: { liffId, isActive: true } });
      if (!integration) throw new UnauthorizedException('LINE Mini App is not configured');
      const line = await this.line.verifyIdToken(integration.id, idToken);
      const identity = await this.prisma.lineIdentity.findFirst({
        where: { lineUserId: line.sub, lineIntegrationId: integration.id },
        include: { resident: true },
      });
      if (!identity || identity.resident.deletedAt) throw new UnauthorizedException('LINE account is not linked');
      return this.issue(identity.resident, identity.lineUserId);
    }
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
  async invite(token: string) {
    const invite = await this.findInvite(token);
    const room = invite.room ?? invite.contract?.room;
    if (!room) throw new GoneException('Invite has no room');
    return {
      expiresAt: invite.expiresAt,
      room: { number: room.number },
      property: { name: room.building.property.name },
      branch: { name: room.building.property.branch.name, address: room.building.property.branch.address, phone: room.building.property.branch.phone },
      residentHint: invite.contract?.resident.fullName.replace(/.(?=.{2})/g, '*'),
    };
  }
  async claim(token: string, dto: ClaimRoomInviteDto) {
    const invite = await this.findInvite(token);
    const room = invite.room ?? invite.contract?.room;
    if (!room) throw new GoneException('Invite has no room');
    const branch = room.building.property.branch;
    const integration = await this.integrationForBranch(branch.id);
    const line = await this.line.verifyIdToken(integration.id, dto.idToken);

    if (invite.contract) {
      const identity = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.roomInvite.updateMany({ where: { id: invite.id, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'CLAIMED', claimedAt: new Date() } });
        if (claimed.count !== 1) throw new GoneException('Invite already claimed or expired');
        return tx.lineIdentity.upsert({ where: { residentId: invite.contract!.residentId }, create: { residentId: invite.contract!.residentId, lineUserId: line.sub, displayName: line.name, pictureUrl: line.picture, lineIntegrationId: integration.id }, update: { lineUserId: line.sub, displayName: line.name, pictureUrl: line.picture, lineIntegrationId: integration.id, linkedAt: new Date() } });
      });
      return { ...(await this.issue(invite.contract.resident, identity.lineUserId)), resident: { id: invite.contract.resident.id, fullName: invite.contract.resident.fullName }, room: { id: room.id, number: room.number } };
    }

    const existingIdentity = await this.prisma.lineIdentity.findUnique({ where: { lineUserId: line.sub }, include: { resident: { include: { contracts: { where: { status: ContractStatus.ACTIVE }, select: { id: true } } } } } });
    if (existingIdentity?.resident.contracts.length) throw new ConflictException('This LINE account already has an active room');
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.roomInvite.updateMany({ where: { id: invite.id, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'CLAIMED', claimedAt: new Date() } });
      if (claimed.count !== 1) throw new GoneException('Invite already claimed or expired');
      const occupied = await tx.room.updateMany({ where: { id: room.id, status: RoomStatus.VACANT, deletedAt: null }, data: { status: RoomStatus.OCCUPIED } });
      if (occupied.count !== 1) throw new ConflictException('Room is no longer vacant');
      const resident = await tx.resident.create({ data: { storeId: invite.storeId, branchId: branch.id, fullName: dto.fullName.trim(), phone: dto.phone?.trim(), email: dto.email?.trim() } });
      const contract = await tx.contract.create({ data: { storeId: invite.storeId, branchId: branch.id, roomId: room.id, residentId: resident.id, startDate: new Date(), monthlyRent: room.monthlyRent, deposit: 0, billingDay: 1, status: ContractStatus.ACTIVE } });
      const identity = await tx.lineIdentity.upsert({ where: { lineUserId: line.sub }, create: { residentId: resident.id, lineUserId: line.sub, displayName: line.name, pictureUrl: line.picture, lineIntegrationId: integration.id }, update: { residentId: resident.id, displayName: line.name, pictureUrl: line.picture, lineIntegrationId: integration.id, linkedAt: new Date() } });
      await tx.auditLog.create({ data: { storeId: invite.storeId, action: 'resident.room_invite_claim', entityType: 'Contract', entityId: contract.id, metadata: { inviteId: invite.id, branchId: branch.id, roomId: room.id, residentId: resident.id } } });
      return { resident, identity };
    });
    return { ...(await this.issue(result.resident, result.identity.lineUserId)), resident: { id: result.resident.id, fullName: result.resident.fullName }, room: { id: room.id, number: room.number }, branch: { id: branch.id, name: branch.name } };
  }
  me(user: ResidentUser) { return this.prisma.resident.findFirstOrThrow({ where: { id: user.residentId, storeId: user.storeId, branchId: user.branchId }, select: { id: true, fullName: true, phone: true, email: true, branch: { select: { id: true, name: true } }, contracts: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, startDate: true, endDate: true, monthlyRent: true, room: { select: { id: true, number: true, building: { select: { name: true, property: { select: { name: true } } } } } } } } } }); }
  async home(user: ResidentUser) {
    const [profile, invoices] = await Promise.all([this.me(user), this.invoices(user)]);
    const invoice = invoices[0] ? await this.invoice(user, invoices[0].id) : null;
    return { profile, invoices, invoice };
  }
  invoices(user: ResidentUser) { return this.prisma.invoice.findMany({ where: { storeId: user.storeId, branchId: user.branchId, status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.VOID] }, contract: { residentId: user.residentId } }, select: { id: true, number: true, status: true, total: true, dueDate: true, issuedAt: true, paidAt: true, room: { select: { number: true } }, period: { select: { year: true, month: true } }, payments: { where: { status: 'APPROVED' }, select: { amount: true } } }, orderBy: { dueDate: 'desc' } }); }
  invoice(user: ResidentUser, id: string) { return this.prisma.invoice.findFirstOrThrow({ where: { id, storeId: user.storeId, branchId: user.branchId, status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.VOID] }, contract: { residentId: user.residentId } }, include: { items: true, room: { select: { number: true } }, period: true, payments: { include: { slip: true } } } }); }
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
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new BadRequestException('Slip must be a JPG, PNG, or WebP image');
    if (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) throw new BadRequestException('Payment amount is invalid');
    if (Number.isNaN(new Date(body.paidAt).getTime())) throw new BadRequestException('Payment date is invalid');
    const invoice = await this.prisma.invoice.findFirst({ where: { id: body.invoiceId, storeId: user.storeId, branchId: user.branchId, contract: { residentId: user.residentId }, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] } }, include: { branch: true, room: true, payments: { where: { status: PaymentStatus.APPROVED }, select: { amount: true } } } });
    if (!invoice) throw new NotFoundException('Payable invoice not found');
    const outstanding = Math.max(0, Number(invoice.total) - invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
    if (Number(body.amount) > outstanding) throw new ConflictException('Payment exceeds outstanding balance');
    const fileUrl = await this.uploadToCloudinary(file, invoice.branch.code, invoice.room.number);
    return this.payment(user, { invoiceId: body.invoiceId, amount: Number(body.amount), paidAt: body.paidAt, fileUrl, fileName: file.originalname, mimeType: file.mimetype, size: file.size });
  }
  private async uploadToCloudinary(file: UploadedSlip, branchCode: string, roomNumber: string): Promise<string> {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiKey || !apiSecret) throw new ConflictException('Cloudinary is not configured');
    const now = new Date(); const day = now.toISOString().slice(0, 10);
    const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');
    const folder = `dormitory/${safe(branchCode)}/${safe(roomNumber)}/${day}`;
    const timestamp = Math.floor(now.getTime() / 1000).toString();
    const signature = createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest('hex');
    const form = new FormData();
    form.append('file', new Blob([file.buffer as unknown as ArrayBuffer], { type: file.mimetype }), file.originalname);
    form.append('api_key', apiKey); form.append('timestamp', timestamp); form.append('folder', folder); form.append('signature', signature);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, { method: 'POST', body: form });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      const message = body?.error?.message ?? `Cloudinary returned HTTP ${response.status}`;
      throw new BadGatewayException(`Cloudinary upload failed: ${message}`);
    }
    const result = await response.json() as { secure_url?: string };
    if (!result.secure_url) throw new ConflictException('Cloudinary did not return a file URL');
    return result.secure_url;
  }
  private async issue(resident: { id: string; storeId: string; branchId: string }, lineUserId: string) { return { accessToken: await this.jwt.signAsync({ sub: resident.id, storeId: resident.storeId, branchId: resident.branchId, lineUserId, type: 'resident' }, { secret: this.config.getOrThrow('JWT_RESIDENT_SECRET'), expiresIn: 3600 }), expiresInSeconds: 3600 }; }
  private async findInvite(token: string) {
    const roomInclude = { building: { include: { property: { include: { branch: true } } } } } as const;
    const invite = await this.prisma.roomInvite.findUnique({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
      include: {
        room: { include: roomInclude },
        contract: { include: { resident: true, room: { include: roomInclude } } },
      },
    });
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt <= new Date()) throw new GoneException('Invite invalid or expired');
    return invite;
  }
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
