import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { assertBranchAccess } from '../common/branch-access';
import { SubmitPaymentDto, UpsertPromptPayDto } from './payments.dto';
import { generatePromptPayPayload } from './promptpay';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}
  async promptPay(user: RequestUser, branchId: string) {
    assertBranchAccess(user, branchId);
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, storeId: user.storeId, deletedAt: null } });
    if (!branch) throw new NotFoundException('Branch not found');
    const setting = await this.prisma.promptPaySetting.findUnique({ where: { branchId } });
    if (!setting) return null;
    return this.withPreview(setting);
  }
  async upsertPromptPay(user: RequestUser, branchId: string, dto: UpsertPromptPayDto) {
    assertBranchAccess(user, branchId);
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, storeId: user.storeId, deletedAt: null } }); if (!branch) throw new NotFoundException('Branch not found');
    generatePromptPayPayload(dto.type, dto.target, 1);
    const setting = await this.prisma.promptPaySetting.upsert({ where: { branchId }, create: { branchId, ...dto }, update: { ...dto, enabled: true } });
    return this.withPreview(setting);
  }
  private async withPreview(setting: { id: string; branchId: string; type: import('@prisma/client').PromptPayType; target: string; accountName: string; enabled: boolean; createdAt: Date; updatedAt: Date }) {
    const previewAmount = 100;
    const payload = generatePromptPayPayload(setting.type, setting.target, previewAmount);
    return { ...setting, previewAmount, qrDataUrl: await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 360 }) };
  }
  async qr(user: RequestUser, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, storeId: user.storeId, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] } }, include: { branch: { include: { promptPaySetting: true } }, payments: { where: { status: PaymentStatus.APPROVED } } } }); if (!invoice) throw new NotFoundException('Payable invoice not found'); assertBranchAccess(user, invoice.branchId);
    const setting = invoice.branch.promptPaySetting; if (!setting?.enabled) throw new NotFoundException('PromptPay is not configured');
    const approved = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0); const outstanding = Math.max(0, Number(invoice.total) - approved);
    if (outstanding <= 0) throw new ConflictException('Invoice has no outstanding balance');
    const payload = generatePromptPayPayload(setting.type, setting.target, outstanding);
    return { invoiceId, amount: outstanding, accountName: setting.accountName, payload, qrDataUrl: await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 480 }) };
  }
  async submit(user: RequestUser, dto: SubmitPaymentDto) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: dto.invoiceId, storeId: user.storeId, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] } } }); if (!invoice) throw new NotFoundException('Payable invoice not found'); assertBranchAccess(user, invoice.branchId);
    return this.prisma.payment.create({ data: { storeId: user.storeId, branchId: invoice.branchId, invoiceId: invoice.id, amount: dto.amount, paidAt: new Date(dto.paidAt), slip: { create: { fileUrl: dto.fileUrl } } }, include: { slip: true } });
  }
  pending(user: RequestUser, branchId: string) { assertBranchAccess(user, branchId); return this.prisma.payment.findMany({ where: { storeId: user.storeId, branchId, status: PaymentStatus.PENDING }, include: { slip: true, invoice: { include: { room: true, contract: { include: { resident: true } } } } }, orderBy: { createdAt: 'asc' } }); }
  async approve(user: RequestUser, paymentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id: paymentId, storeId: user.storeId }, include: { invoice: true } }); if (!payment) throw new NotFoundException('Payment not found'); assertBranchAccess(user, payment.branchId);
      if (payment.status !== PaymentStatus.PENDING) throw new ConflictException('Payment has already been reviewed');
      const claimed = await tx.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.PENDING }, data: { status: PaymentStatus.APPROVED, reviewedBy: user.id, reviewedAt: new Date() } }); if (claimed.count !== 1) throw new ConflictException('Payment has already been reviewed');
      const approved = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const aggregate = await tx.payment.aggregate({ where: { invoiceId: payment.invoiceId, status: PaymentStatus.APPROVED }, _sum: { amount: true } });
      const paid = Number(aggregate._sum.amount ?? 0); const fullyPaid = paid >= Number(payment.invoice.total);
      await tx.invoice.update({ where: { id: payment.invoiceId }, data: { status: fullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID, paidAt: fullyPaid ? new Date() : null } });
      await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'payment.approve', entityType: 'Payment', entityId: payment.id, metadata: { invoiceId: payment.invoiceId, amount: payment.amount.toString() } } });
      return { payment: approved, invoiceStatus: fullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID, approvedTotal: paid };
    });
  }
  async reject(user: RequestUser, paymentId: string, reason: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, storeId: user.storeId } }); if (!payment) throw new NotFoundException('Payment not found'); assertBranchAccess(user, payment.branchId);
    return this.prisma.$transaction(async (tx) => { const result = await tx.payment.updateMany({ where: { id: paymentId, storeId: user.storeId, status: PaymentStatus.PENDING }, data: { status: PaymentStatus.REJECTED, reviewedBy: user.id, reviewedAt: new Date(), rejectReason: reason } });
      if (!result.count) throw new ConflictException('Payment not found or already reviewed'); await tx.auditLog.create({ data: { storeId: user.storeId, actorUserId: user.id, action: 'payment.reject', entityType: 'Payment', entityId: paymentId, metadata: { reason } } }); return { id: paymentId, status: PaymentStatus.REJECTED }; });
  }
}
