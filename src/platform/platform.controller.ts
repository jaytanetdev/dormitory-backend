import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, PlatformOnly } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { CreateStoreDto } from './platform.dto';
import { PlatformService } from './platform.service';
@ApiBearerAuth() @ApiTags('Platform') @Controller('platform')
export class PlatformController { constructor(private readonly service: PlatformService) {} @Get('stores') @PlatformOnly() list() { return this.service.listStores(); } @Post('stores') @PlatformOnly() create(@CurrentUser() user: RequestUser, @Body() dto: CreateStoreDto) { return this.service.createStore(user, dto); } }
