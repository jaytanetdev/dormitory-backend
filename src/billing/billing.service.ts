import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LineService } from '../line/line.service';
import type { RequestUser } from '../common/request-user';
import { assertBranchAccess } from '../common/branch-access';
import { CreateBillingPeriodDto, CreateInvoiceDto, CreateMeterReadingDto } from './billing.dto';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService, private readonly line: LineService, private readonly config: ConfigService) {}
  async createMeterReading(user: RequestUser, dto: CreateMeterReadingDto) {
    if (dto.currentValue < dto.previousValue) throw new BadRequestException('Current meter value cannot be lower than previous value');
    const room = await this.prisma.room.findFirst({ where: { id: dto.roomId, building: { property: { storeId: user.storeId } } }, include: { building: { include: { property: true } } } }); if (!room) throw new NotFoundException('Room not found'); assertBranchAccess(user, room.building.property.branchId);
    return this.prisma.meterReading.create({ data: { ...dto, readingDate: new Date(dto.readingDate) } });
  }
  async createPeriod(user: RequestUser, branchId: string, dto: CreateBillingPeriodDto) {
    assertBranchAccess(user, branchId);
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, storeId: user.storeId, deletedAt: null } }); if (!branch) throw new NotFoundException('Branch not found');
    return this.prisma.billingPeriod.create({ data: { storeId: user.storeId, branchId, ...dto, dueDate: new Date(dto.dueDate) } });
  }
  listInvoices(user: RequestUser, branchId: string) { assertBranchAccess(user, branchId); return this.prisma.invoice.findMany({ where: { storeId: user.storeId, branchId }, include: { room: true, contract: { include: { resident: true } }, items: true, payments: { include: { slip: true } } }, orderBy: { createdAt: 'desc' } }); }
  async createInvoice(user: RequestUser, dto: CreateInvoiceDto) {
    assertBranchAccess(user, dto.branchId);
    const [period, contract] = await Promise.all([this.prisma.billingPeriod.findFirst({ where: { id: dto.periodId, storeId: user.storeId, branchId: dto.branchId } }), this.prisma.contract.findFirst({ where: { id: dto.contractId, storeId: user.storeId, branchId: dto.branchId, status: 'ACTIVE' } })]);
    if (!period || !contract) throw new BadRequestException('Invalid billing period or active contract');
    const amounts = dto.items.map((item) => Number((item.quantity * item.unitPrice).toFixed(2))); const subtotal = amounts.reduce((sum, value) => sum + value, 0); const total = Math.max(0, subtotal - dto.discount);
    try { return await this.prisma.$transaction(async (tx) => { const invoice = await tx.invoice.create({ data: { storeId: user.storeId, branchId: dto.branchId, periodId: dto.periodId, contractId: dto.contractId, roomId: contract.roomId, number: dto.number, subtotal, discount: dto.discount, total, dueDate: period.dueDate, items: { create: dto.items.map((item, index) => ({ ...item, amount: amounts[index], metadata: item.metadata as Prisma.InputJsonValue | undefined })) } }, include: { items: true } }); await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'invoice.create', entityType: 'Invoice', entityId: invoice.id, metadata: { number: invoice.number, total: invoice.total.toString() } } }); return invoice; }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Invoice already exists for contract and period, or number is duplicated'); throw error; }
  }
  async issueInvoice(user: RequestUser, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, storeId: user.storeId }, include: { room: true, contract: { include: { resident: true } } } }); if (!invoice) throw new NotFoundException('Invoice not found'); assertBranchAccess(user, invoice.branchId);
    if (invoice.status !== InvoiceStatus.DRAFT) throw new ConflictException('Only draft invoice can be issued');
    const updated = await this.prisma.$transaction(async (tx) => { const issued = await tx.invoice.update({ where: { id: invoice.id }, data: { status: InvoiceStatus.ISSUED, issuedAt: new Date() } }); await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'invoice.issue', entityType: 'Invoice', entityId: invoice.id, metadata: { number: invoice.number, total: invoice.total.toString() } } }); return issued; });
    let notification: object = { status: 'SKIPPED', reason: 'LINE_NOT_LINKED' };
    try { notification = await this.line.sendToResident(user.storeId, invoice.branchId, invoice.contract.residentId, 'invoice-issued', { invoiceId, roomNumber: invoice.room.number, total: invoice.total.toString(), dueDate: invoice.dueDate.toISOString(), url: `${this.config.get('PUBLIC_APP_URL')}/invoices/${invoiceId}` }); } catch { /* issuance must succeed even without a LINE identity */ }
    return { invoice: updated, notification };
  }
}
