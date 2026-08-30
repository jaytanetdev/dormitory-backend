import { IsObject, IsString } from 'class-validator';
export class SendLineDto { @IsString() residentId!: string; @IsString() template!: string; @IsObject() payload!: Record<string, unknown>; }
