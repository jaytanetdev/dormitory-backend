import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsPositive, IsString } from 'class-validator';
import { PromptPayType } from '@prisma/client';
export class UpsertPromptPayDto { @IsEnum(PromptPayType) type!: PromptPayType; @IsString() target!: string; @IsString() accountName!: string; }
export class SubmitPaymentDto { @IsString() invoiceId!: string; @Type(() => Number) @IsNumber() @IsPositive() amount!: number; @IsDateString() paidAt!: string; @IsString() fileUrl!: string; }
export class RejectPaymentDto { @IsString() reason!: string; }
