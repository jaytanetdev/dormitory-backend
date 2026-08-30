import { Module } from '@nestjs/common';
import { LineModule } from '../line/line.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
@Module({ imports: [LineModule], controllers: [BillingController], providers: [BillingService] })
export class BillingModule {}
