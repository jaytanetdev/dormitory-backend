import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const prisma = { $connect: jest.fn(), $disconnect: jest.fn(), $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('v1'); await app.init();
  });
  afterAll(async () => { if (app) await app.close(); });
  it('reports liveness without authentication', async () => { await request(app.getHttpServer()).get('/v1/health/live').expect(200).expect(({ body }) => expect(body.status).toBe('ok')); });
});
