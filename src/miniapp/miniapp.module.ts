import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MiniappController } from './miniapp.controller';
import { MiniappService } from './miniapp.service';
import { ResidentJwtGuard } from './resident-jwt.guard';
import { LineModule } from '../line/line.module';
@Module({ imports: [JwtModule.register({}), LineModule], controllers: [MiniappController], providers: [MiniappService, ResidentJwtGuard] })
export class MiniappModule {}
