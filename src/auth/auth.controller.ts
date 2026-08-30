import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { LoginDto, RefreshDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('Auth') @Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}
  @Public() @Post('login') @HttpCode(200) login(@Body() dto: LoginDto) { return this.service.login(dto); }
  @Public() @Post('refresh') @HttpCode(200) refresh(@Body() dto: RefreshDto) { return this.service.refresh(dto.refreshToken); }
  @Public() @Post('logout') @HttpCode(204) logout(@Body() dto: RefreshDto) { return this.service.logout(dto.refreshToken); }
  @ApiBearerAuth() @Get('me') me(@CurrentUser() user: RequestUser): RequestUser { return user; }
}
