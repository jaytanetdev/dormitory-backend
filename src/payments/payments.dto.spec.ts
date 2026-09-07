import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RejectPaymentDto } from './payments.dto';

describe('payment rejection reason', () => {
  it('rejects blank reasons and trims usable reasons', async () => {
    expect(await validate(plainToInstance(RejectPaymentDto, { reason: '   ' }))).not.toHaveLength(0);
    const dto = plainToInstance(RejectPaymentDto, { reason: '  สลิปไม่ชัด  ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.reason).toBe('สลิปไม่ชัด');
  });
});
