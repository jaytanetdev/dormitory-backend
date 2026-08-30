import { Body, Controller, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentResident, Public, ResidentRoute } from '../common/decorators';
import type { ResidentUser } from '../common/request-user';
import { ClaimBranchRoomDto, ClaimRoomInviteDto, LineIdTokenDto, MiniPaymentDto } from './miniapp.dto';
import { ResidentJwtGuard } from './resident-jwt.guard';
import { MiniappService } from './miniapp.service';
type UploadedSlip = { buffer: Buffer; mimetype: string; originalname: string; size: number };
@ApiTags('Mini App') @Controller('miniapp') @ResidentRoute() @UseGuards(ResidentJwtGuard)
export class MiniappController {
  constructor(private readonly service: MiniappService) {}
  @Public() @Post('auth/line') auth(@Body() dto: LineIdTokenDto) { return this.service.authenticate(dto.idToken, dto.liffId); }
  @Public() @Get('branches/:claimCode') branchClaimInfo(@Param('claimCode') claimCode: string) { return this.service.branchClaimInfo(claimCode); }
  @Public() @Post('branches/:claimCode/claim') branchClaim(@Param('claimCode') claimCode: string, @Body() dto: ClaimBranchRoomDto) { return this.service.claimBranchRoom(claimCode, dto); }
  @Public() @Get('invites/:token') invite(@Param('token') token: string) { return this.service.invite(token); }
  @Public() @Post('invites/:token/claim') claim(@Param('token') token: string, @Body() dto: ClaimRoomInviteDto) { return this.service.claim(token, dto); }
  @ApiBearerAuth() @Get('me') me(@CurrentResident() user: ResidentUser) { return this.service.me(user); }
  @ApiBearerAuth() @Get('home') home(@CurrentResident() user: ResidentUser) { return this.service.home(user); }
  @ApiBearerAuth() @Get('invoices') invoices(@CurrentResident() user: ResidentUser) { return this.service.invoices(user); }
  @ApiBearerAuth() @Get('invoices/:id') invoice(@CurrentResident() user: ResidentUser, @Param('id') id: string) { return this.service.invoice(user, id); }
  @ApiBearerAuth() @Get('invoices/:id/payment-qr') paymentQr(@CurrentResident() user: ResidentUser, @Param('id') id: string) { return this.service.paymentQr(user, id); }
  @ApiBearerAuth() @Post('payments') payment(@CurrentResident() user: ResidentUser, @Body() dto: MiniPaymentDto) { return this.service.payment(user, dto); }
  @ApiBearerAuth() @Post('payments/slip') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } })) uploadSlip(@CurrentResident() user: ResidentUser, @UploadedFile() file: UploadedSlip, @Body() body: { invoiceId: string; amount: string; paidAt: string }) { return this.service.uploadSlip(user, file, body); }
}
