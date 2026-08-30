import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { AccessService } from './access.service';
import { CreateBranchDto, CreateRoleDto, CreateUserDto, UpdateBranchDto, UpdateRolePermissionsDto } from './access.dto';

@ApiBearerAuth() @ApiTags('Access control') @Controller()
export class AccessController {
  constructor(private readonly service: AccessService) {}
  @Get('branches') @RequirePermissions('branch.view') branches(@CurrentUser() user: RequestUser) { return this.service.listBranches(user); }
  @Post('branches') @RequirePermissions('branch.create') createBranch(@CurrentUser() user: RequestUser, @Body() dto: CreateBranchDto) { return this.service.createBranch(user, dto); }
  @Patch('branches/:branchId') @RequirePermissions('branch.update') updateBranch(@CurrentUser() user: RequestUser, @Param('branchId') id: string, @Body() dto: UpdateBranchDto) { return this.service.updateBranch(user, id, dto); }
  @Delete('branches/:branchId') @RequirePermissions('branch.update') deleteBranch(@CurrentUser() user: RequestUser, @Param('branchId') id: string) { return this.service.deleteBranch(user, id); }
  @Get('permissions') @RequirePermissions('role.view') permissions() { return this.service.permissionMatrix(); }
  @Get('roles') @RequirePermissions('role.view') roles(@CurrentUser() user: RequestUser) { return this.service.listRoles(user); }
  @Post('roles') @RequirePermissions('role.create') createRole(@CurrentUser() user: RequestUser, @Body() dto: CreateRoleDto) { return this.service.createRole(user, dto); }
  @Patch('roles/:roleId/permissions') @RequirePermissions('role.update') updateRole(@CurrentUser() user: RequestUser, @Param('roleId') id: string, @Body() dto: UpdateRolePermissionsDto) { return this.service.updateRolePermissions(user, id, dto); }
  @Get('users') @RequirePermissions('user.view') users(@CurrentUser() user: RequestUser) { return this.service.listUsers(user); }
  @Post('users') @RequirePermissions('user.create') createUser(@CurrentUser() user: RequestUser, @Body() dto: CreateUserDto) { return this.service.createUser(user, dto); }
}
