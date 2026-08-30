import { ForbiddenException } from '@nestjs/common';
import { assertBranchAccess } from './branch-access';
import type { RequestUser } from './request-user';
const user = (allBranches: boolean): RequestUser => ({ id: 'u1', storeId: 's1', roleId: 'r1', permissions: [], allBranches, branchIds: ['b1'], isPlatformAdmin: false });
describe('assertBranchAccess', () => {
  it('rejects cross-branch entity access', () => expect(() => assertBranchAccess(user(false), 'b2')).toThrow(ForbiddenException));
  it('allows assigned and all-branch actors', () => { expect(() => assertBranchAccess(user(false), 'b1')).not.toThrow(); expect(() => assertBranchAccess(user(true), 'b2')).not.toThrow(); });
});
