import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: config.getOrThrow('JWT_ACCESS_SECRET') });
  }
  async validate(payload: { sub: string; type: string }): Promise<RequestUser> {
    if (payload.type !== 'access') throw new UnauthorizedException();
    const user = await this.prisma.user.findFirst({ where: { id: payload.sub, deletedAt: null, status: 'ACTIVE' }, include: { role: { include: { permissions: { include: { permission: true } } } }, branches: true } });
    if (!user || user.role.deletedAt) throw new UnauthorizedException();
    return { id: user.id, storeId: user.storeId, roleId: user.roleId, permissions: user.role.permissions.map((item) => item.permission.key), allBranches: user.allBranches, branchIds: user.branches.map((item) => item.branchId), isPlatformAdmin: user.isPlatformAdmin };
  }
}
