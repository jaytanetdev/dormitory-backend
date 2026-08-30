import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { assertBranchAccess } from '../common/branch-access';
import { LineCredentialsService } from './line-credentials';

@Injectable()
export class LineService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly credentials: LineCredentialsService) {}
  async sendToResident(storeId: string, branchId: string, residentId: string, template: string, payload: Record<string, unknown>) {
    const identity = await this.prisma.lineIdentity.findFirst({ where: { residentId, resident: { storeId, branchId } } });
    if (!identity) throw new NotFoundException('Resident has not linked LINE');
    const integration = await this.prisma.lineIntegration.findFirst({ where: { branchId, isActive: true } });
    const notificationPayload = template === 'invoice-issued' && typeof payload.url === 'string'
      ? { ...payload, url: this.withLiffId(payload.url, integration?.liffId) }
      : payload;
    const jsonPayload = notificationPayload as Prisma.InputJsonValue;
    if (!integration) return this.prisma.notificationLog.create({ data: { lineIdentityId: identity.id, template, payload: jsonPayload, status: 'SKIPPED', errorCode: 'LINE_NOT_CONFIGURED_FOR_BRANCH' } });
    const token = this.credentials.decrypt(integration.channelAccessTokenEncrypted);
    try {
      const response = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ to: identity.lineUserId, messages: [this.toMessage(template, notificationPayload)] }) });
      if (!response.ok) throw new Error(`LINE_HTTP_${response.status}`);
      return this.prisma.notificationLog.create({ data: { lineIdentityId: identity.id, template, payload: jsonPayload, status: 'SENT', externalId: response.headers.get('x-line-request-id') } });
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 100) : 'UNKNOWN';
      return this.prisma.notificationLog.create({ data: { lineIdentityId: identity.id, template, payload: jsonPayload, status: 'FAILED', errorCode: code } });
    }
  }
  async sendAsStaff(user: RequestUser, residentId: string, template: string, payload: Record<string, unknown>) { const resident = await this.prisma.resident.findFirst({ where: { id: residentId, storeId: user.storeId, deletedAt: null } }); if (!resident) throw new NotFoundException('Resident not found'); assertBranchAccess(user, resident.branchId); return this.sendToResident(user.storeId, resident.branchId, residentId, template, payload); }
  async verifySignature(integrationId: string, body: Buffer, signature: string | undefined): Promise<boolean> {
    const integration = await this.prisma.lineIntegration.findFirst({ where: { id: integrationId, isActive: true } });
    if (!integration || !signature) return false;
    const secret = this.credentials.decrypt(integration.messagingChannelSecretEncrypted);
    const expected = createHmac('sha256', secret).update(body).digest('base64');
    return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
  async verifyIdToken(integrationId: string, idToken: string): Promise<{ sub: string; name?: string; picture?: string }> {
    if (this.config.get('NODE_ENV') !== 'production' && idToken.startsWith('mock-line:')) return { sub: idToken.slice(10), name: 'Mock LINE User' };
    const integration = await this.prisma.lineIntegration.findFirst({ where: { id: integrationId, isActive: true } });
    if (!integration) throw new NotFoundException('LINE integration not found');
    const body = new URLSearchParams({ id_token: idToken, client_id: integration.miniAppChannelId });
    const response = await fetch('https://api.line.me/oauth2/v2.1/verify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!response.ok) throw new NotFoundException('Invalid LINE ID token');
    const result = await response.json() as { sub?: string; name?: string; picture?: string };
    if (!result.sub) throw new NotFoundException('LINE token has no subject');
    return { sub: result.sub, name: result.name, picture: result.picture };
  }
  private toMessage(template: string, payload: Record<string, unknown>): object {
    const scalar = (value: unknown, fallback: string): string => typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
    if (template === 'invoice-issued') return { type: 'flex', altText: `มีใบแจ้งหนี้ใหม่ ยอด ${scalar(payload.total, '')} บาท`, contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'ใบแจ้งหนี้พร้อมชำระ', weight: 'bold', size: 'lg' }, { type: 'text', text: `ห้อง ${scalar(payload.roomNumber, '-')}` }, { type: 'text', text: `ยอด ${scalar(payload.total, '0')} บาท` }] }, footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: 'ดูรายละเอียดและชำระ', uri: scalar(payload.url, this.config.get<string>('PUBLIC_APP_URL', 'http://localhost:3001')) } }] } } };
    return { type: 'text', text: scalar(payload.message, template) };
  }
  private withLiffId(url: string, liffId: string | undefined): string {
    if (!liffId) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}liffId=${encodeURIComponent(liffId)}`;
  }
}
