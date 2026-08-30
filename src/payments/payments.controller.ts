import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped, CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { PaymentsService } from './payments.service';
import { RejectPaymentDto, SubmitPaymentDto, UpsertPromptPayDto } from './payments.dto';

@ApiBearerAuth() @ApiTags('Payments') @Controller()
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}
  @Get('branches/:branchId/promptpay') @RequirePermissions('settings.view') @BranchScoped() promptPaySetting(@CurrentUser() u: RequestUser, @Param('branchId') id: string) { return this.service.promptPay(u, id); }
  @Put('branches/:branchId/promptpay') @RequirePermissions('settings.update') @BranchScoped() promptPay(@CurrentUser() u: RequestUser, @Param('branchId') id: string, @Body() d: UpsertPromptPayDto) { return this.service.upsertPromptPay(u, id, d); }
  @Get('invoices/:invoiceId/payment-qr') @RequirePermissions('invoice.view') qr(@CurrentUser() u: RequestUser, @Param('invoiceId') id: string) { return this.service.qr(u, id); }
  @Post('payments') @RequirePermissions('payment.create') submit(@CurrentUser() u: RequestUser, @Body() d: SubmitPaymentDto) { return this.service.submit(u, d); }
  @Get('branches/:branchId/payments/pending') @RequirePermissions('payment.view') @BranchScoped() pending(@CurrentUser() u: RequestUser, @Param('branchId') id: string) { return this.service.pending(u, id); }
  @Post('payments/:paymentId/approve') @RequirePermissions('payment.approve') approve(@CurrentUser() u: RequestUser, @Param('paymentId') id: string) { return this.service.approve(u, id); }
  @Post('payments/:paymentId/reject') @RequirePermissions('payment.approve') reject(@CurrentUser() u: RequestUser, @Param('paymentId') id: string, @Body() d: RejectPaymentDto) { return this.service.reject(u, id, d.reason); }
}
