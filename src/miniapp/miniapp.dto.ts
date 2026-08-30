import { Type } from 'class-transformer';
import { IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUrl, Max } from 'class-validator';
export class LineIdTokenDto { @IsString() idToken!: string; }
export class ClaimBranchRoomDto extends LineIdTokenDto {
  @IsString() roomNumber!: string;
  @IsString() fullName!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
}
export class ClaimRoomInviteDto extends LineIdTokenDto {
  @IsString() fullName!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
}
export class MiniPaymentDto {
  @IsString() invoiceId!: string; @Type(() => Number) @IsNumber() @IsPositive() amount!: number; @IsDateString() paidAt!: string;
  @IsUrl({ protocols: ['https'], require_protocol: true }) fileUrl!: string; @IsOptional() @IsString() fileName?: string;
  @IsOptional() @IsIn(['image/jpeg', 'image/png', 'application/pdf']) mimeType?: string; @IsOptional() @Type(() => Number) @IsInt() @IsPositive() @Max(10_000_000) size?: number;
}
