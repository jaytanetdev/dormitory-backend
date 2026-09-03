import { Body, Controller, ForbiddenException, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { SendLineDto } from './line.dto';
import { LineService } from './line.service';

@ApiTags('LINE') @Controller('line')
export class LineController {
  constructor(private readonly service: LineService) {}
  @ApiBearerAuth() @Get('quota') @RequirePermissions('notification.send') quota(@CurrentUser() user: RequestUser, @Query('branchId') branchId: string) { return this.service.quota(user, branchId); }
  @ApiBearerAuth() @Post('push') @RequirePermissions('notification.send') push(@CurrentUser() user: RequestUser, @Body() dto: SendLineDto) { return this.service.sendAsStaff(user, dto.residentId, dto.template, dto.payload); }
  @ApiBearerAuth() @Get('conversations/:residentId') @RequirePermissions('notification.send') conversations(@CurrentUser() user: RequestUser, @Param('residentId') residentId: string) { return this.service.conversations(user, residentId); }
  @Public() @Post('webhook/:integrationId') async webhook(@Param('integrationId') integrationId: string, @Req() req: RawBodyRequest<Request>, @Headers('x-line-signature') signature?: string): Promise<object> {
    if (!req.rawBody || !(await this.service.verifySignature(integrationId, req.rawBody, signature))) throw new ForbiddenException('Invalid LINE signature');
    await this.service.handleWebhook(integrationId, req.body as { events?: Array<{ type?: string; source?: { userId?: string }; message?: { id?: string; type?: string; text?: string }}> });
    return { accepted: true, eventCount: Array.isArray((req.body as { events?: unknown[] }).events) ? (req.body as { events: unknown[] }).events.length : 0 };
  }
}
