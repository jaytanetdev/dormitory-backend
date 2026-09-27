import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { ResponseInterceptor } from "../src/common/response.interceptor";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
const branch = "11111111-1111-4111-8111-111111111111";
describe("HTTP workflow authorization with real JWT and validation", () => {
  let app: INestApplication,
    db: any,
    jwt: JwtService,
    permissions: string[],
    platform: boolean;
  const token = (type = "access", secret = process.env.JWT_ACCESS_SECRET!) =>
    jwt.sign({ sub: "staff", type }, { secret, expiresIn: 60 });
  beforeAll(async () => {
    db = {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      user: {
        findFirst: jest
          .fn()
          .mockImplementation(() => ({
            id: "staff",
            storeId: "store",
            roleId: "role",
            allBranches: false,
            isPlatformAdmin: platform,
            branches: [{ branchId: branch }],
            role: {
              name: "test",
              deletedAt: null,
              permissions: permissions.map((key) => ({ permission: { key } })),
            },
          })),
      },
      branch: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
      lineIdentity: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    jwt = app.get(JwtService);
  });
  beforeEach(() => {
    permissions = [];
    platform = false;
  });
  afterAll(async () => {
    await app.close();
  });
  const endpoints = [
    ["get", "/branches"],
    ["get", "/users"],
    ["post", "/users"],
    ["patch", "/users/user"],
    ["post", "/branches"],
    ["patch", "/branches/" + branch],
    ["get", "/roles"],
    ["post", "/roles"],
    ["get", "/permissions"],
    ["get", "/branches/" + branch + "/properties"],
    ["post", "/properties"],
    ["post", "/buildings/building/rooms"],
    ["post", "/rooms/room/invites"],
    ["get", "/branches/" + branch + "/residents"],
    ["post", "/contracts"],
    ["patch", "/contracts/contract/status"],
    ["get", "/branches/" + branch + "/invoices"],
    ["post", "/invoices"],
    ["post", "/invoices/bill/issue"],
    ["get", "/rooms/room/meter-readings/latest"],
    ["post", "/meter-readings"],
    ["get", "/branches/" + branch + "/payments/pending"],
    ["post", "/payments/pay/approve"],
    ["post", "/payments/pay/reject"],
    ["put", "/branches/" + branch + "/promptpay"],
    ["post", "/line/push"],
    ["get", "/platform/stores"],
  ];
  it.each(endpoints)("anonymous cannot %s %s", async (method, path) => {
    await (request(app.getHttpServer()) as any)
      [method]("/v1" + path)
      .send({})
      .expect(401);
  });
  it.each(endpoints)(
    "staff without permission cannot %s %s",
    async (method, path) => {
      await (request(app.getHttpServer()) as any)
        [method]("/v1" + path)
        .set("Authorization", "Bearer " + token())
        .send({})
        .expect(403);
    },
  );
  it("valid authorized read returns API envelope", async () => {
    permissions = ["branch.view"];
    await request(app.getHttpServer())
      .get("/v1/branches")
      .set("Authorization", "Bearer " + token())
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual([]));
  });
  it("branch guard prevents reads from another branch", async () => {
    permissions = ["invoice.view"];
    await request(app.getHttpServer())
      .get("/v1/branches/22222222-2222-4222-8222-222222222222/invoices")
      .set("Authorization", "Bearer " + token())
      .expect(403);
    expect(db.invoice.findMany).not.toHaveBeenCalled();
  });
  it("authorized create still validates body and forbids extra fields", async () => {
    permissions = ["user.create"];
    await request(app.getHttpServer())
      .post("/v1/users")
      .set("Authorization", "Bearer " + token())
      .send({ email: "invalid", password: "short", isPlatformAdmin: true })
      .expect(400);
  });
  it("owner with role permissions cannot enter platform endpoints", async () => {
    permissions = ["role.view"];
    await request(app.getHttpServer())
      .get("/v1/roles")
      .set("Authorization", "Bearer " + token())
      .expect(403);
  });
  it("rejects token signed by another secret", async () => {
    await request(app.getHttpServer())
      .get("/v1/branches")
      .set("Authorization", "Bearer " + token("access", "wrong-secret"))
      .expect(401);
  });
  it("rejects refresh token as staff access token", async () => {
    await request(app.getHttpServer())
      .get("/v1/branches")
      .set("Authorization", "Bearer " + token("refresh"))
      .expect(401);
  });
  for (const path of [
    "/miniapp/me",
    "/miniapp/home",
    "/miniapp/invoices",
    "/miniapp/invoices/bill",
    "/miniapp/invoices/bill/payment-qr",
  ])
    it("resident route requires resident session " + path, async () => {
      await request(app.getHttpServer())
        .get("/v1" + path)
        .expect(401);
      await request(app.getHttpServer())
        .get("/v1" + path)
        .set("Authorization", "Bearer " + token())
        .expect(401);
    });
  it("resident token is checked against current LINE identity", async () => {
    const resident = jwt.sign(
      {
        sub: "resident",
        type: "resident",
        lineUserId: "line",
        storeId: "store",
        branchId: branch,
      },
      { secret: process.env.JWT_RESIDENT_SECRET!, expiresIn: 60 },
    );
    await request(app.getHttpServer())
      .get("/v1/miniapp/invoices")
      .set("Authorization", "Bearer " + resident)
      .expect(401);
    expect(db.lineIdentity.findFirst).toHaveBeenCalled();
  });
});
