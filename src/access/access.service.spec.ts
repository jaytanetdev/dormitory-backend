import { BadRequestException, ConflictException } from "@nestjs/common";
import { AccessService } from "./access.service";
import type { RequestUser } from "../common/request-user";
const actor: RequestUser = {
  id: "u1",
  storeId: "s1",
  roleId: "r1",
  permissions: ["room.view"],
  allBranches: false,
  branchIds: ["b1"],
  isPlatformAdmin: false,
};
describe("AccessService security", () => {
  it("prevents granting permissions the actor does not hold", async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new AccessService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.createRole(actor, {
        name: "Escalated",
        permissionKeys: ["payment.approve"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("prevents modification of immutable system roles", async () => {
    const prisma = {
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: "owner", isSystem: true }),
      },
    };
    const service = new AccessService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.updateRolePermissions(actor, "owner", {
        permissionKeys: ["room.view"],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it("prevents branch-scope escalation when creating a user", async () => {
    const prisma = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: "r1" }) },
      branch: { count: jest.fn().mockResolvedValue(1) },
      rolePermission: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AccessService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.createUser(actor, {
        email: "x@y.com",
        password: "12345678",
        displayName: "X",
        roleId: "r1",
        allBranches: false,
        branchIds: ["b2"],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

const update = {
  displayName: "Team",
  roleId: "staff",
  allBranches: false,
  branchIds: ["b1"],
  status: "ACTIVE" as const,
};
describe("staff management", () => {
  const target = {
    id: "u2",
    allBranches: false,
    isPlatformAdmin: false,
    role: {
      isSystem: false,
      permissions: [{ permission: { key: "room.view" } }],
    },
    branches: [{ branchId: "b1" }],
  };
  function setup(value = target) {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(value) },
      role: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: "staff",
            isSystem: false,
            scopeLevel: "BRANCH",
            permissions: [{ permission: { key: "room.view" } }],
          }),
      },
      branch: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(),
    };
    return {
      prisma,
      service: new AccessService(prisma as never, {} as never, {} as never),
    };
  }
  it("blocks editing the current account", async () => {
    const { service, prisma } = setup({ ...target, id: actor.id });
    await expect(
      service.updateUser(actor, actor.id, update),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("protects system accounts", async () => {
    const { service } = setup({
      ...target,
      role: { ...target.role, isSystem: true },
    });
    await expect(
      service.updateUser(actor, "u2", update),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it("blocks editing a user in another branch", async () => {
    const { service, prisma } = setup({
      ...target,
      branches: [{ branchId: "b2" }],
    });
    await expect(
      service.updateUser(actor, "u2", update),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("blocks assigning a more powerful role", async () => {
    const { service, prisma } = setup();
    prisma.role.findFirst.mockResolvedValue({
      id: "staff",
      isSystem: false,
      scopeLevel: "BRANCH",
      permissions: [{ permission: { key: "payment.approve" } }],
    });
    await expect(
      service.updateUser(actor, "u2", update),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("blocks expanding branch scope", async () => {
    const { service, prisma } = setup();
    await expect(
      service.updateUser(actor, "u2", { ...update, allBranches: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("suspends a staff account, revokes refresh sessions and writes an audit record", async () => {
    const { service, prisma } = setup();
    const tx = {
      userBranch: { deleteMany: jest.fn() },
      user: {
        update: jest.fn().mockResolvedValue({ id: "u2", status: "SUSPENDED" }),
      },
      refreshSession: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    await service.updateUser(actor, "u2", { ...update, status: "SUSPENDED" });
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u2", revokedAt: null } }),
    );
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allBranches: false,
          roleId: "staff",
          status: "SUSPENDED",
        }),
      }),
    );
  });
  it("returns only roles within the actors permission set", async () => {
    const prisma = {
      role: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "allowed",
            permissions: [{ permission: { key: "room.view" } }],
          },
          {
            id: "blocked",
            permissions: [{ permission: { key: "payment.approve" } }],
          },
        ]),
      },
    };
    const service = new AccessService(
      prisma as never,
      {} as never,
      {} as never,
    );
    expect(
      (await service.assignableRoles(actor)).map((role) => role.id),
    ).toEqual(["allowed"]);
  });
});
