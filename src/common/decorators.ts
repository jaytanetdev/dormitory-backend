import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthenticatedRequest, RequestUser, ResidentRequest, ResidentUser } from './request-user';

export const PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);
export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);
export const BRANCH_PARAM_KEY = 'branchParam';
export const BranchScoped = (parameter = 'branchId'): MethodDecorator & ClassDecorator => SetMetadata(BRANCH_PARAM_KEY, parameter);
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): RequestUser => context.switchToHttp().getRequest<AuthenticatedRequest>().user);
export const RESIDENT_ROUTE_KEY = 'residentRoute';
export const ResidentRoute = (): MethodDecorator & ClassDecorator => SetMetadata(RESIDENT_ROUTE_KEY, true);
export const PLATFORM_ONLY_KEY = 'platformOnly';
export const PlatformOnly = (): MethodDecorator & ClassDecorator => SetMetadata(PLATFORM_ONLY_KEY, true);
export const CurrentResident = createParamDecorator((_data: unknown, context: ExecutionContext): ResidentUser => context.switchToHttp().getRequest<ResidentRequest>().resident);
