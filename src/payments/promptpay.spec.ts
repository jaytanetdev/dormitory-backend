import { PromptPayType } from '@prisma/client';
import { generatePromptPayPayload } from './promptpay';

describe('generatePromptPayPayload', () => {
  it('creates a dynamic Thai QR payload for a phone and amount', () => {
    const payload = generatePromptPayPayload(PromptPayType.PHONE, '081-234-5678', 4300);
    expect(payload).toContain('0066812345678'); expect(payload).toContain('54074300.00'); expect(payload).toMatch(/6304[0-9A-F]{4}$/);
  });
  it('rejects malformed phone numbers', () => { expect(() => generatePromptPayPayload(PromptPayType.PHONE, '123', 100)).toThrow(); });
  it('rejects zero amount', () => { expect(() => generatePromptPayPayload(PromptPayType.NATIONAL_ID, '1234567890123', 0)).toThrow(); });
});
