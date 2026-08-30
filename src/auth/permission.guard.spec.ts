import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';

describe('PermissionGuard', () => {
  it('denies a user missing required permission', () => {
    const reflector = { getAllAndOverride: jest.fn((key: string) => key === 'permissions' ? ['invoice.issue'] : false) } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ user: { permissions: ['invoice.view'] } }) }) };
    expect(() => guard.canActivate(context as never)).toThrow(ForbiddenException);
  });
});
