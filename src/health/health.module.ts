import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Public() @Get('live') live(): object { return { status: 'ok' }; }
  @Public() @Get('ready') async ready(): Promise<object> { await this.prisma.$queryRaw`SELECT 1`; return { status: 'ready', database: 'up' }; }
}
@Module({ controllers: [HealthController] })
export class HealthModule {}
