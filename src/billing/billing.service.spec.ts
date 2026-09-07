import { BillingService } from './billing.service';
import type { RequestUser } from '../common/request-user';

describe('invoice due date', () => {
  const user: RequestUser = { id: 'user', storeId: 'store', roleId: 'role', permissions: [], allBranches: true, branchIds: [], isPlatformAdmin: false };
  it.each([
    ['2026-10-12', '2026-10-12T00:00:00.000Z'],
    [undefined, '2026-10-06T00:00:00.000Z'],
  ])('uses the selected date or billing period instead of the move-in date (%s)', async (dueDate, expected) => {
    const create = jest.fn(async ({ data }) => ({ ...data, id: 'invoice', total: 1000 }));
    const tx = { invoice: { create }, auditLog: { create: jest.fn() } };
    const prisma = {
      billingPeriod: { findFirst: jest.fn().mockResolvedValue({ id: 'period', dueDate: new Date('2026-10-06') }) },
      contract: { findFirst: jest.fn().mockResolvedValue({ roomId: 'room', startDate: new Date('2025-01-01'), branch: { invoiceDueDays: 5 } }) },
      $transaction: jest.fn(async (run) => run(tx)),
    };
    const service = new BillingService(prisma as never, {} as never, {} as never);
    await service.createInvoice(user, { branchId: 'branch', periodId: 'period', contractId: 'contract', number: 'INV-1', discount: 0, dueDate, items: [{ code: 'RENT', description: 'Rent', quantity: 1, unitPrice: 1000 }] });
    expect(create.mock.calls[0][0].data.dueDate.toISOString()).toBe(expected);
  });
});
