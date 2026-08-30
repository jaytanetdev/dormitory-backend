import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PUBLIC_KEY } from '../common/decorators';
import type { ResidentRequest, ResidentUser } from '../common/request-user';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class ResidentJwtGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly config: ConfigService, private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<ResidentRequest>(); const raw = request.headers.authorization?.replace(/^Bearer\s+/i, ''); if (!raw) throw new UnauthorizedException();
    let claims: ResidentUser & { type: string; sub: string };
    try { claims = await this.jwt.verifyAsync(raw, { secret: this.config.getOrThrow('JWT_RESIDENT_SECRET') }); } catch { throw new UnauthorizedException('Invalid resident token'); }
    if (claims.type !== 'resident') throw new UnauthorizedException();
    const identity = await this.prisma.lineIdentity.findFirst({ where: { residentId: claims.sub, lineUserId: claims.lineUserId, resident: { deletedAt: null } }, include: { resident: true } });
    if (!identity) throw new UnauthorizedException(); request.resident = { residentId: identity.residentId, storeId: identity.resident.storeId, branchId: identity.resident.branchId, lineUserId: identity.lineUserId }; return true;
  }
}
