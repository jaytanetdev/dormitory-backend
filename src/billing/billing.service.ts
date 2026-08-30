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
    await this.assertReadingContinuity(dto.roomId, dto.type, dto.previousValue, new Date(dto.readingDate));
    return this.prisma.meterReading.create({ data: { ...dto, readingDate: new Date(dto.readingDate) } });
  }
  async latestMeterReadings(user: RequestUser, roomId: string) {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, deletedAt: null, building: { property: { storeId: user.storeId, deletedAt: null } } }, include: { building: { include: { property: true } } } });
    if (!room) throw new NotFoundException('Room not found');
    assertBranchAccess(user, room.building.property.branchId);
    const [water, electric] = await Promise.all([
      this.prisma.meterReading.findFirst({ where: { roomId, type: 'WATER' }, orderBy: { readingDate: 'desc' } }),
      this.prisma.meterReading.findFirst({ where: { roomId, type: 'ELECTRIC' }, orderBy: { readingDate: 'desc' } }),
    ]);
    return { WATER: water, ELECTRIC: electric };
  }
  async createPeriod(user: RequestUser, branchId: string, dto: CreateBillingPeriodDto) {
    assertBranchAccess(user, branchId);
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, storeId: user.storeId, deletedAt: null } }); if (!branch) throw new NotFoundException('Branch not found');
    return this.prisma.billingPeriod.upsert({ where: { branchId_year_month: { branchId, year: dto.year, month: dto.month } }, create: { storeId: user.storeId, branchId, ...dto, dueDate: new Date(dto.dueDate) }, update: { dueDate: new Date(dto.dueDate) } });
  }
  listInvoices(user: RequestUser, branchId: string) { assertBranchAccess(user, branchId); return this.prisma.invoice.findMany({ where: { storeId: user.storeId, branchId }, include: { room: true, contract: { include: { resident: true } }, items: true, payments: { include: { slip: true } } }, orderBy: { createdAt: 'desc' } }); }
  async createInvoice(user: RequestUser, dto: CreateInvoiceDto) {
    assertBranchAccess(user, dto.branchId);
    const [period, contract] = await Promise.all([this.prisma.billingPeriod.findFirst({ where: { id: dto.periodId, storeId: user.storeId, branchId: dto.branchId } }), this.prisma.contract.findFirst({ where: { id: dto.contractId, storeId: user.storeId, branchId: dto.branchId, status: 'ACTIVE' } })]);
    if (!period || !contract) throw new BadRequestException('Invalid billing period or active contract');
    const amounts = dto.items.map((item) => Number((item.quantity * item.unitPrice).toFixed(2))); const subtotal = amounts.reduce((sum, value) => sum + value, 0); const total = Math.max(0, subtotal - dto.discount);
    try { return await this.prisma.$transaction(async (tx) => {
      for (const reading of dto.meterReadings ?? []) {
        if (reading.currentValue < reading.previousValue) throw new BadRequestException('Current meter value cannot be lower than previous value');
        const units = Number((reading.currentValue - reading.previousValue).toFixed(3));
        const invoiceItem = dto.items.find((item) => item.code === reading.type);
        if (units > 0 && !invoiceItem) throw new BadRequestException(`${reading.type} charge is missing from invoice items`);
        if (invoiceItem && (Math.abs(invoiceItem.quantity - units) > 0.0001 || Math.abs(invoiceItem.unitPrice - reading.unitRate) > 0.0001)) throw new BadRequestException(`${reading.type} charge does not match meter units and rate`);
        const latest = await tx.meterReading.findFirst({ where: { roomId: contract.roomId, type: reading.type }, orderBy: { readingDate: 'desc' } });
        if (latest && Math.abs(Number(latest.currentValue) - reading.previousValue) > 0.0001) throw new ConflictException(`Previous ${reading.type.toLowerCase()} meter must equal the latest reading (${latest.currentValue.toString()})`);
        if (latest && new Date(reading.readingDate) <= latest.readingDate) throw new ConflictException(`New ${reading.type.toLowerCase()} reading date must be after the latest reading`);
        await tx.meterReading.create({ data: { roomId: contract.roomId, ...reading, readingDate: new Date(reading.readingDate) } });
      }
      const invoice = await tx.invoice.create({ data: { storeId: user.storeId, branchId: dto.branchId, periodId: dto.periodId, contractId: dto.contractId, roomId: contract.roomId, number: dto.number, subtotal, discount: dto.discount, total, dueDate: period.dueDate, items: { create: dto.items.map((item, index) => ({ ...item, amount: amounts[index], metadata: item.metadata as Prisma.InputJsonValue | undefined })) } }, include: { items: true } });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'invoice.create', entityType: 'Invoice', entityId: invoice.id, metadata: { number: invoice.number, total: invoice.total.toString(), meterReadings: dto.meterReadings?.length ?? 0 } } });
      return invoice;
    }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Invoice already exists for contract and period, or number is duplicated'); throw error; }
  }
  async issueInvoice(user: RequestUser, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, storeId: user.storeId }, include: { room: true, branch: { include: { lineIntegration: true } }, contract: { include: { resident: true } } } }); if (!invoice) throw new NotFoundException('Invoice not found'); assertBranchAccess(user, invoice.branchId);
    if (invoice.status !== InvoiceStatus.DRAFT) throw new ConflictException('Only draft invoice can be issued');
    const updated = await this.prisma.$transaction(async (tx) => { const issued = await tx.invoice.update({ where: { id: invoice.id }, data: { status: InvoiceStatus.ISSUED, issuedAt: new Date() } }); await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'invoice.issue', entityType: 'Invoice', entityId: invoice.id, metadata: { number: invoice.number, total: invoice.total.toString() } } }); return issued; });
    let notification: object = { status: 'SKIPPED', reason: 'LINE_NOT_LINKED' };
    const liffId = invoice.branch.lineIntegration?.liffId;
    const invoiceUrl = liffId
      ? `https://miniapp.line.me/${encodeURIComponent(liffId)}/invoices/${encodeURIComponent(invoiceId)}?liffId=${encodeURIComponent(liffId)}`
      : `${this.config.get('PUBLIC_APP_URL')}/invoices/${invoiceId}`;
    try { notification = await this.line.sendToResident(user.storeId, invoice.branchId, invoice.contract.residentId, 'invoice-issued', { invoiceId, roomNumber: invoice.room.number, total: invoice.total.toString(), dueDate: invoice.dueDate.toISOString(), url: invoiceUrl }); } catch { /* issuance must succeed even without a LINE identity */ }
    return { invoice: updated, notification };
  }
  private async assertReadingContinuity(roomId: string, type: CreateMeterReadingDto['type'], previousValue: number, readingDate: Date) {
    const latest = await this.prisma.meterReading.findFirst({ where: { roomId, type }, orderBy: { readingDate: 'desc' } });
    if (!latest) return;
    if (Math.abs(Number(latest.currentValue) - previousValue) > 0.0001) throw new ConflictException(`Previous ${type.toLowerCase()} meter must equal the latest reading (${latest.currentValue.toString()})`);
    if (readingDate <= latest.readingDate) throw new ConflictException(`New ${type.toLowerCase()} reading date must be after the latest reading`);
  }
}
