import { ForbiddenException } from '@nestjs/common';
import type { RequestUser } from './request-user';
export const assertBranchAccess = (user: RequestUser, branchId: string): void => {
  if (!user.allBranches && !user.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
};
