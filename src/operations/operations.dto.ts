import { Type } from 'class-transformer';
import { IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';
import { ContractStatus, RoomStatus } from '@prisma/client';

export class CreatePropertyDto { @IsString() branchId!: string; @IsString() name!: string; @IsString() typeName!: string; @IsOptional() @IsString() address?: string; }
export class CreateBuildingDto { @IsString() name!: string; }
export class CreateRoomTypeDto { @IsString() name!: string; @IsOptional() @IsString() description?: string; @Type(() => Number) @IsNumber() @IsPositive() baseRent!: number; }
export class CreateRoomDto { @IsString() roomTypeId!: string; @IsString() number!: string; @IsOptional() @IsString() floor?: string; @Type(() => Number) @IsNumber() @IsPositive() monthlyRent!: number; }
export class UpdateRoomStatusDto { @IsEnum(RoomStatus) status!: RoomStatus; }
export class CreateResidentDto { @IsString() branchId!: string; @IsString() fullName!: string; @IsOptional() @IsString() phone?: string; @IsOptional() @IsEmail() email?: string; @IsOptional() @IsString() nationalId?: string; }
export class CreateContractDto {
  @IsString() branchId!: string; @IsString() roomId!: string; @IsString() residentId!: string; @IsDateString() startDate!: string; @IsOptional() @IsDateString() endDate?: string;
  @Type(() => Number) @IsNumber() @IsPositive() monthlyRent!: number; @Type(() => Number) @IsNumber() @Min(0) deposit!: number; @Type(() => Number) @IsInt() @Min(1) @Max(28) billingDay!: number;
}
export class UpdateContractStatusDto { @IsEnum(ContractStatus) status!: ContractStatus; }
export class CreateInviteDto { @Type(() => Number) @IsInt() @Min(1) @Max(168) expiresInHours = 48; }
