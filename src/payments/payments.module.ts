import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { LineModule } from '../line/line.module';
@Module({ imports: [LineModule], controllers: [PaymentsController], providers: [PaymentsService] })
export class PaymentsModule {}
