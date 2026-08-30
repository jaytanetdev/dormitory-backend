import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BRANCH_PARAM_KEY, PUBLIC_KEY, RESIDENT_ROUTE_KEY } from '../common/decorators';
import type { AuthenticatedRequest } from '../common/request-user';

@Injectable()
export class BranchScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]) || this.reflector.getAllAndOverride<boolean>(RESIDENT_ROUTE_KEY, [context.getHandler(), context.getClass()])) return true;
    const key = this.reflector.getAllAndOverride<string>(BRANCH_PARAM_KEY, [context.getHandler(), context.getClass()]);
    if (!key) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const body = request.body as Record<string, unknown> | undefined;
    const branchId = String(request.params[key] ?? body?.[key] ?? request.query[key] ?? '');
    if (!request.user.allBranches && !request.user.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
    return true;
  }
}
