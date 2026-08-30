import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
export class CreateStoreDto { @IsString() name!: string; @Matches(/^[a-z0-9-]{3,50}$/) slug!: string; @IsString() branchName!: string; @IsString() branchCode!: string; @IsEmail() ownerEmail!: string; @IsString() ownerName!: string; @IsString() @MinLength(12) ownerPassword!: string; }
