import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { LineModule } from '../line/line.module';
@Module({ imports: [LineModule], controllers: [AccessController], providers: [AccessService] })
export class AccessModule {}
