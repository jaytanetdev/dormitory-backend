import { BadRequestException, ConflictException } from '@nestjs/common';
import { AccessService } from './access.service';
import type { RequestUser } from '../common/request-user';
const actor: RequestUser = { id: 'u1', storeId: 's1', roleId: 'r1', permissions: ['room.view'], allBranches: false, branchIds: ['b1'], isPlatformAdmin: false };
describe('AccessService security', () => {
  it('prevents granting permissions the actor does not hold', async () => {
    const prisma = { $transaction: jest.fn() }; const service = new AccessService(prisma as never, {} as never, {} as never);
    await expect(service.createRole(actor, { name: 'Escalated', permissionKeys: ['payment.approve'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('prevents modification of immutable system roles', async () => {
    const prisma = { role: { findFirst: jest.fn().mockResolvedValue({ id: 'owner', isSystem: true }) } }; const service = new AccessService(prisma as never, {} as never, {} as never);
    await expect(service.updateRolePermissions(actor, 'owner', { permissionKeys: ['room.view'] })).rejects.toBeInstanceOf(ConflictException);
  });
  it('prevents branch-scope escalation when creating a user', async () => {
    const prisma = { role: { findFirst: jest.fn().mockResolvedValue({ id: 'r1' }) }, branch: { count: jest.fn().mockResolvedValue(1) }, rolePermission: { findMany: jest.fn().mockResolvedValue([]) } }; const service = new AccessService(prisma as never, {} as never, {} as never);
    await expect(service.createUser(actor, { email: 'x@y.com', password: '12345678', displayName: 'X', roleId: 'r1', allBranches: false, branchIds: ['b2'] })).rejects.toBeInstanceOf(BadRequestException);
  });
});
