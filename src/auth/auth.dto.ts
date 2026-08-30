import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'owner@demo.local' }) @IsEmail() email!: string;
  @ApiProperty({ example: 'Dormitory123!' }) @IsString() @MinLength(8) password!: string;
  @ApiProperty({ example: 'demo-store' }) @IsString() storeSlug!: string;
}
export class RefreshDto { @IsString() refreshToken!: string; }
