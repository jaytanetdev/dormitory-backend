import type { Request } from 'express';

export interface RequestUser {
  id: string;
  storeId: string;
  roleId: string;
  permissions: string[];
  allBranches: boolean;
  branchIds: string[];
  isPlatformAdmin: boolean;
}
export interface ResidentUser { residentId: string; storeId: string; branchId: string; lineUserId: string; }
export type AuthenticatedRequest = Request & { user: RequestUser };
export type ResidentRequest = Request & { resident: ResidentUser };
