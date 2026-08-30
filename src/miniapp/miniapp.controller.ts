import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentResident, Public, ResidentRoute } from '../common/decorators';
import type { ResidentUser } from '../common/request-user';
import { ClaimBranchRoomDto, LineIdTokenDto, MiniPaymentDto } from './miniapp.dto';
import { ResidentJwtGuard } from './resident-jwt.guard';
import { MiniappService } from './miniapp.service';
@ApiTags('Mini App') @Controller('miniapp') @ResidentRoute() @UseGuards(ResidentJwtGuard)
export class MiniappController {
  constructor(private readonly service: MiniappService) {}
  @Public() @Post('auth/line') auth(@Body() dto: LineIdTokenDto) { return this.service.authenticate(dto.idToken); }
  @Public() @Get('branches/:claimCode') branchClaimInfo(@Param('claimCode') claimCode: string) { return this.service.branchClaimInfo(claimCode); }
  @Public() @Post('branches/:claimCode/claim') branchClaim(@Param('claimCode') claimCode: string, @Body() dto: ClaimBranchRoomDto) { return this.service.claimBranchRoom(claimCode, dto); }
  @Public() @Get('invites/:token') invite(@Param('token') token: string) { return this.service.invite(token); }
  @Public() @Post('invites/:token/claim') claim(@Param('token') token: string, @Body() dto: LineIdTokenDto) { return this.service.claim(token, dto.idToken); }
  @ApiBearerAuth() @Get('me') me(@CurrentResident() user: ResidentUser) { return this.service.me(user); }
  @ApiBearerAuth() @Get('invoices') invoices(@CurrentResident() user: ResidentUser) { return this.service.invoices(user); }
  @ApiBearerAuth() @Get('invoices/:id') invoice(@CurrentResident() user: ResidentUser, @Param('id') id: string) { return this.service.invoice(user, id); }
  @ApiBearerAuth() @Get('invoices/:id/payment-qr') paymentQr(@CurrentResident() user: ResidentUser, @Param('id') id: string) { return this.service.paymentQr(user, id); }
  @ApiBearerAuth() @Post('payments') payment(@CurrentResident() user: ResidentUser, @Body() dto: MiniPaymentDto) { return this.service.payment(user, dto); }
}
