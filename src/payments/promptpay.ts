import { BadRequestException } from '@nestjs/common';
import { PromptPayType } from '@prisma/client';

const field = (id: string, value: string): string => `${id}${value.length.toString().padStart(2, '0')}${value}`;
const crc16 = (input: string): string => {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) { crc ^= byte << 8; for (let i = 0; i < 8; i += 1) crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};
const normalizeTarget = (type: PromptPayType, raw: string): { proxyId: string; value: string } => {
  const target = raw.replace(/\D/g, '');
  if (type === PromptPayType.PHONE) {
    if (!/^0\d{9}$/.test(target)) throw new BadRequestException('PromptPay phone must be 10 digits beginning with 0');
    return { proxyId: '01', value: `0066${target.slice(1)}` };
  }
  if (type === PromptPayType.NATIONAL_ID || type === PromptPayType.TAX_ID) {
    if (!/^\d{13}$/.test(target)) throw new BadRequestException('PromptPay ID must contain 13 digits');
    return { proxyId: '02', value: target };
  }
  if (!target) throw new BadRequestException('PromptPay target is invalid');
  return { proxyId: '03', value: target };
};
export const generatePromptPayPayload = (type: PromptPayType, target: string, amount: number): string => {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9_999_999.99) throw new BadRequestException('Invalid PromptPay amount');
  const proxy = normalizeTarget(type, target);
  const merchant = field('00', 'A000000677010111') + field(proxy.proxyId, proxy.value);
  const body = field('00', '01') + field('01', '12') + field('29', merchant) + field('53', '764') + field('54', amount.toFixed(2)) + field('58', 'TH') + '6304';
  return body + crc16(body);
};
