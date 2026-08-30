import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PLATFORM_ONLY_KEY, PUBLIC_KEY, RESIDENT_ROUTE_KEY } from '../common/decorators';
import type { AuthenticatedRequest } from '../common/request-user';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]) || this.reflector.getAllAndOverride<boolean>(RESIDENT_ROUTE_KEY, [context.getHandler(), context.getClass()])) return true;
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY_KEY, [context.getHandler(), context.getClass()]) && !user?.isPlatformAdmin) throw new ForbiddenException('Platform administrator required');
    if (!user || !required.every((key) => user.permissions.includes(key))) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
