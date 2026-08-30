import { Module } from '@nestjs/common';
import { LineController } from './line.controller';
import { LineService } from './line.service';
import { LineCredentialsService } from './line-credentials';
@Module({ controllers: [LineController], providers: [LineService, LineCredentialsService], exports: [LineService, LineCredentialsService] })
export class LineModule {}
