import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNumber, IsPositive, IsString, Max, Min } from 'class-validator';
import { PromptPayType } from '@prisma/client';
export class UpsertPromptPayDto { @IsEnum(PromptPayType) type!: PromptPayType; @IsString() target!: string; @IsString() accountName!: string; @Type(() => Number) @IsInt() @Min(0) @Max(31) invoiceDueDays = 5; }
export class SubmitPaymentDto { @IsString() invoiceId!: string; @Type(() => Number) @IsNumber() @IsPositive() amount!: number; @IsDateString() paidAt!: string; @IsString() fileUrl!: string; }
export class RejectPaymentDto { @IsString() reason!: string; }
