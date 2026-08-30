import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchScoped, CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { BillingService } from './billing.service';
import { CreateBillingPeriodDto, CreateInvoiceDto, CreateMeterReadingDto } from './billing.dto';

@ApiBearerAuth() @ApiTags('Billing') @Controller()
export class BillingController {
  constructor(private readonly service: BillingService) {}
  @Post('meter-readings') @RequirePermissions('meter.create') createReading(@CurrentUser() u: RequestUser, @Body() d: CreateMeterReadingDto) { return this.service.createMeterReading(u, d); }
  @Post('branches/:branchId/billing-periods') @RequirePermissions('invoice.create') @BranchScoped() period(@CurrentUser() u: RequestUser, @Param('branchId') id: string, @Body() d: CreateBillingPeriodDto) { return this.service.createPeriod(u, id, d); }
  @Get('branches/:branchId/invoices') @RequirePermissions('invoice.view') @BranchScoped() invoices(@CurrentUser() u: RequestUser, @Param('branchId') id: string) { return this.service.listInvoices(u, id); }
  @Post('invoices') @RequirePermissions('invoice.create') @BranchScoped() createInvoice(@CurrentUser() u: RequestUser, @Body() d: CreateInvoiceDto) { return this.service.createInvoice(u, d); }
  @Post('invoices/:invoiceId/issue') @RequirePermissions('invoice.issue') issue(@CurrentUser() u: RequestUser, @Param('invoiceId') id: string) { return this.service.issueInvoice(u, id); }
}
