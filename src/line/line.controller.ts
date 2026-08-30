import { Body, Controller, ForbiddenException, Headers, Param, Post, Req } from '@nestjs/common';
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
  @ApiBearerAuth() @Post('push') @RequirePermissions('notification.send') push(@CurrentUser() user: RequestUser, @Body() dto: SendLineDto) { return this.service.sendAsStaff(user, dto.residentId, dto.template, dto.payload); }
  @Public() @Post('webhook/:integrationId') async webhook(@Param('integrationId') integrationId: string, @Req() req: RawBodyRequest<Request>, @Headers('x-line-signature') signature?: string): Promise<object> {
    if (!req.rawBody || !(await this.service.verifySignature(integrationId, req.rawBody, signature))) throw new ForbiddenException('Invalid LINE signature');
    return { accepted: true, eventCount: Array.isArray((req.body as { events?: unknown[] }).events) ? (req.body as { events: unknown[] }).events.length : 0 };
  }
}
