import { PlatformService } from "./platform.service";
import { Prisma } from "@prisma/client";
jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashed-password"),
}));
describe("new store onboarding", () => {
  let db: any, service: PlatformService;
  const dto = {
    name: "Test store",
    slug: "qa-store",
    branchName: "Main",
    branchCode: "main",
    ownerName: "Owner",
    ownerEmail: "OWNER@EXAMPLE.INVALID",
    ownerPassword: "TestPassword123!",
  };
  beforeEach(() => {
    db = {
      permission: {
        findMany: jest.fn().mockResolvedValue([
          { id: "view", key: "room.view" },
          { id: "approve", key: "payment.approve" },
          { id: "user", key: "user.create" },
        ]),
      },
      store: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "store" }),
      },
      branch: { create: jest.fn().mockResolvedValue({ id: "branch" }) },
      role: { create: jest.fn().mockResolvedValue({ id: "role" }) },
      user: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: "owner", ...data }),
          ),
      },
      auditLog: { create: jest.fn() },
    };
    db.$transaction = jest.fn((fn: any) => fn(db));
    service = new PlatformService(db);
  });
  it("creates store, uppercase branch, owner, default staff roles and audit", async () => {
    const result = await service.createStore({ id: "platform" } as never, dto);
    expect(db.branch.create.mock.calls[0][0].data.code).toBe("MAIN");
    expect(db.role.create).toHaveBeenCalledTimes(4);
    expect(db.user.create.mock.calls[0][0].data).toMatchObject({
      email: "owner@example.invalid",
      passwordHash: "hashed-password",
      allBranches: true,
    });
    expect(result.owner).not.toHaveProperty("passwordHash");
    expect(db.auditLog.create.mock.calls[0][0].data.action).toBe(
      "platform.store.create",
    );
  });
  it("read-only preset cannot approve payments or create users", async () => {
    await service.createStore({ id: "platform" } as never, dto);
    const role = db.role.create.mock.calls.find(
      (call: any) => call[0].data.name === "ดูรายงาน",
    )[0].data;
    expect(role.permissions.create).toEqual([{ permissionId: "view" }]);
  });
  it("duplicate slug becomes a conflict", async () => {
    db.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "6",
      }),
    );
    await expect(
      service.createStore({ id: "platform" } as never, dto),
    ).rejects.toThrow("already exists");
  });
  it("lists only active stores with summary counts", async () => {
    await service.listStores();
    expect(db.store.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
    });
  });
});
