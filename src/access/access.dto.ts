import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

export class CreateBranchDto {
  @IsString() name!: string; @IsString() code!: string; @IsOptional() @IsString() address?: string; @IsOptional() @IsString() phone?: string;
  @IsString() lineDisplayName!: string; @IsString() lineChannelAccessToken!: string; @IsString() lineChannelSecret!: string;
  @IsString() lineLoginChannelId!: string; @IsString() lineLiffId!: string;
  @IsOptional() @IsString() lineMiniAppChannelId?: string; @IsOptional() @IsString() lineMiniAppChannelSecret?: string;
  @IsOptional() @IsString() lineMessagingChannelId?: string; @IsOptional() @IsString() lineMessagingChannelSecret?: string;
}
export class UpdateBranchDto {
  @IsString() name!: string; @IsOptional() @IsString() address?: string; @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() lineDisplayName?: string; @IsOptional() @IsString() lineChannelAccessToken?: string; @IsOptional() @IsString() lineChannelSecret?: string;
  @IsOptional() @IsString() lineLoginChannelId?: string; @IsOptional() @IsString() lineLiffId?: string; @IsOptional() @IsBoolean() lineIsActive?: boolean;
  @IsOptional() @IsString() lineMiniAppChannelId?: string; @IsOptional() @IsString() lineMiniAppChannelSecret?: string;
  @IsOptional() @IsString() lineMessagingChannelId?: string; @IsOptional() @IsString() lineMessagingChannelSecret?: string;
}
export class CreateRoleDto { @IsString() name!: string; @IsOptional() @IsString() description?: string; @IsArray() @ArrayUnique() @IsString({ each: true }) permissionKeys!: string[]; }
export class UpdateRolePermissionsDto { @IsArray() @ArrayUnique() @IsString({ each: true }) permissionKeys!: string[]; }
export class CreateUserDto {
  @IsEmail() email!: string; @IsString() @MinLength(8) password!: string; @IsString() displayName!: string;
  @IsString() roleId!: string; @IsBoolean() allBranches!: boolean; @IsArray() @ArrayUnique() @IsString({ each: true }) branchIds!: string[];
}
export class PermissionMatrixItemDto { @IsString() module!: string; @IsArray() @ValidateNested({ each: true }) @Type(() => PermissionActionDto) actions!: PermissionActionDto[]; }
export class PermissionActionDto { @IsString() key!: string; @IsString() action!: string; }
