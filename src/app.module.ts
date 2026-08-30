import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionGuard } from './auth/permission.guard';
import { BranchScopeGuard } from './auth/branch-scope.guard';
import { HealthModule } from './health/health.module';
import { AccessModule } from './access/access.module';
import { OperationsModule } from './operations/operations.module';
import { BillingModule } from './billing/billing.module';
import { PaymentsModule } from './payments/payments.module';
import { LineModule } from './line/line.module';
import { MiniappModule } from './miniapp/miniapp.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (raw) => {
      const config = { ...raw } as Record<string, any>;
      if (!config.DATABASE_URL && config.DB_HOST && config.DB_USERNAME && config.DB_DATABASE) {
        const user = encodeURIComponent(String(config.DB_USERNAME));
        const password = encodeURIComponent(String(config.DB_PASSWORD ?? ''));
        const port = String(config.DB_PORT ?? 5432);
        config.DATABASE_URL = `postgresql://${user}:${password}@${config.DB_HOST}:${port}/${config.DB_DATABASE}?schema=public`;
        process.env.DATABASE_URL = config.DATABASE_URL;
      }
      const { error, value } = Joi.object({
      NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
      PORT: Joi.number().default(4000), DATABASE_URL: Joi.string().required(),
      DB_HOST: Joi.string().optional(), DB_USERNAME: Joi.string().optional(), DB_PASSWORD: Joi.string().allow('').optional(), DB_PORT: Joi.number().default(5432), DB_DATABASE: Joi.string().optional(),
      JWT_ACCESS_SECRET: Joi.string().min(32).required(), JWT_REFRESH_SECRET: Joi.string().min(32).required(), JWT_RESIDENT_SECRET: Joi.string().min(32).required(),
      JWT_ACCESS_TTL: Joi.string().default('15m'), JWT_REFRESH_TTL: Joi.string().default('7d'),
      CORS_ORIGINS: Joi.string().default('http://localhost:3000'), LINE_CHANNEL_ACCESS_TOKEN: Joi.string().allow('').optional(),
      LINE_CHANNEL_SECRET: Joi.string().allow('').optional(), LINE_LOGIN_CHANNEL_ID: Joi.string().allow('').optional(),
      LINE_CREDENTIAL_ENCRYPTION_KEY: Joi.string().required(), PUBLIC_APP_URL: Joi.string().uri().default('http://localhost:3001'),
      CLOUDINARY_CLOUD_NAME: Joi.string().allow('').optional(), CLOUDINARY_API_KEY: Joi.string().allow('').optional(), CLOUDINARY_API_SECRET: Joi.string().allow('').optional()
      }).unknown(true).validate(config, { abortEarly: false });
      if (error) throw error;
      return value;
    } }),
    PrismaModule, AuthModule, HealthModule, AccessModule, OperationsModule, BillingModule, PaymentsModule, LineModule, MiniappModule, PlatformModule
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: BranchScopeGuard }
  ]
})
export class AppModule {}
