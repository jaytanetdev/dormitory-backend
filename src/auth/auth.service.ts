import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './auth.dto';

interface RefreshClaims { sub: string; sid: string; ver: number; type: 'refresh'; }
export interface TokenPair { accessToken: string; refreshToken: string; expiresInSeconds: number; }

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({ where: { email: dto.email.toLowerCase(), deletedAt: null, status: 'ACTIVE', store: { slug: dto.storeSlug, deletedAt: null } } });
    if (!user || !(await compare(dto.password, user.passwordHash))) throw new UnauthorizedException('Invalid credentials');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issuePair(user.id, user.tokenVersion);
  }

  async refresh(raw: string): Promise<TokenPair> {
    let claims: RefreshClaims;
    try { claims = await this.jwt.verifyAsync<RefreshClaims>(raw, { secret: this.config.getOrThrow('JWT_REFRESH_SECRET') }); }
    catch { throw new UnauthorizedException('Invalid refresh token'); }
    if (claims.type !== 'refresh') throw new UnauthorizedException('Invalid token type');
    const session = await this.prisma.refreshSession.findUnique({ where: { id: claims.sid }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.tokenVersion !== claims.ver || !(await compare(raw, session.tokenHash))) {
      throw new UnauthorizedException('Refresh token expired or reused');
    }
    await this.prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.issuePair(session.userId, session.user.tokenVersion);
  }

  async logout(raw: string): Promise<void> {
    try {
      const claims = await this.jwt.verifyAsync<RefreshClaims>(raw, { secret: this.config.getOrThrow('JWT_REFRESH_SECRET') });
      await this.prisma.refreshSession.updateMany({ where: { id: claims.sid, userId: claims.sub, revokedAt: null }, data: { revokedAt: new Date() } });
    } catch { return; }
  }

  private async issuePair(userId: string, version: number): Promise<TokenPair> {
    const sid = randomUUID();
    const accessTtl = this.durationSeconds(this.config.get<string>('JWT_ACCESS_TTL', '15m'));
    const refreshTtl = this.durationSeconds(this.config.get<string>('JWT_REFRESH_TTL', '7d'));
    const accessToken = await this.jwt.signAsync({ sub: userId, type: 'access' }, { secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: accessTtl });
    const refreshToken = await this.jwt.signAsync<RefreshClaims>({ sub: userId, sid, ver: version, type: 'refresh' }, { secret: this.config.getOrThrow('JWT_REFRESH_SECRET'), expiresIn: refreshTtl });
    const decoded = this.jwt.decode<{ exp: number }>(refreshToken);
    await this.prisma.refreshSession.create({ data: { id: sid, userId, tokenHash: await hash(refreshToken, 12), expiresAt: new Date(decoded.exp * 1000) } });
    return { accessToken, refreshToken, expiresInSeconds: accessTtl };
  }
  private durationSeconds(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value); if (!match) throw new Error('JWT TTL must use s, m, h, or d');
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return Number(match[1]) * multipliers[match[2]];
  }
}
