import { MiniappService } from "./miniapp.service";
import { createHash } from "crypto";
describe("resident registration and LINE identity workflows", () => {
  let db: any,
    service: MiniappService,
    line: any,
    jwt: any,
    branch: any,
    room: any,
    resident: any,
    invite: any;
  beforeEach(() => {
    branch = {
      id: "branch",
      storeId: "store",
      name: "QA",
      lineIntegration: { id: "integration", isActive: true, liffId: "qa-liff" },
    };
    room = {
      id: "room",
      number: "101",
      monthlyRent: 5000,
      building: { property: { name: "QA", branch, branchId: "branch" } },
    };
    resident = {
      id: "resident",
      storeId: "store",
      branchId: "branch",
      fullName: "Resident",
      deletedAt: null,
    };
    invite = {
      id: "invite",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000),
      room,
      contract: null,
    };
    db = {
      branch: { findFirst: jest.fn().mockResolvedValue(branch) },
      room: {
        findMany: jest.fn().mockResolvedValue([room]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      roomInvite: {
        findUnique: jest.fn().mockResolvedValue(invite),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      lineIntegration: {
        findFirst: jest.fn().mockResolvedValue(branch.lineIntegration),
      },
      lineIdentity: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest
          .fn()
          .mockResolvedValue({
            resident,
            residentId: resident.id,
            lineUserId: "line",
            lineIntegrationId: "integration",
          }),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({ lineUserId: "line" }),
      },
      resident: { create: jest.fn().mockResolvedValue(resident) },
      contract: { create: jest.fn().mockResolvedValue({ id: "contract" }) },
      auditLog: { create: jest.fn() },
    };
    db.$transaction = jest.fn((fn: any) => fn(db));
    line = {
      verifyIdToken: jest.fn().mockResolvedValue({ sub: "line", name: "QA" }),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue("resident-jwt") };
    service = new MiniappService(
      db,
      { get: () => "production", getOrThrow: () => "secret" } as never,
      jwt,
      line,
    );
  });
  const input = {
    idToken: "line-token",
    fullName: " Resident ",
    phone: "0812345678",
  };
  it("branch claim creates resident, active contract and linked identity", async () => {
    expect(
      await service.claimBranchRoom("code", { ...input, roomNumber: " 101 " }),
    ).toMatchObject({
      accessToken: "resident-jwt",
      resident: { id: "resident" },
      room: { number: "101" },
      branch: { id: "branch" },
    });
    expect(db.room.findMany.mock.calls[0][0].where).toMatchObject({
      number: "101",
      status: "VACANT",
      building: { property: { branchId: "branch", storeId: "store" } },
    });
    expect(db.contract.create.mock.calls[0][0].data.status).toBe("ACTIVE");
    expect(db.room.update.mock.calls[0][0].data.status).toBe("OCCUPIED");
    expect(db.lineIdentity.upsert).toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalled();
  });
  it.each([0, 2])("branch room lookup count=%s is rejected", async (count) => {
    db.room.findMany.mockResolvedValue(Array(count).fill(room));
    await expect(
      service.claimBranchRoom("code", { ...input, roomNumber: "101" }),
    ).rejects.toThrow();
    expect(db.resident.create).not.toHaveBeenCalled();
  });
  it("cannot claim branch room when LINE already has an active tenancy", async () => {
    db.lineIdentity.findUnique.mockResolvedValue({
      resident: { contracts: [{ id: "active" }] },
    });
    await expect(
      service.claimBranchRoom("code", { ...input, roomNumber: "101" }),
    ).rejects.toThrow("active room");
    expect(db.resident.create).not.toHaveBeenCalled();
  });
  it("branch link requires active LINE integration", async () => {
    branch.lineIntegration.isActive = false;
    await expect(
      service.claimBranchRoom("code", { ...input, roomNumber: "101" }),
    ).rejects.toThrow("not found");
    expect(line.verifyIdToken).not.toHaveBeenCalled();
  });
  it("rejects unverified LINE identity before creating anything", async () => {
    line.verifyIdToken.mockRejectedValue(Error("invalid token"));
    await expect(
      service.claimBranchRoom("code", { ...input, roomNumber: "101" }),
    ).rejects.toThrow("invalid token");
    expect(db.resident.create).not.toHaveBeenCalled();
  });
  it("room invite hashes token for lookup and masks resident name", async () => {
    invite.contract = { resident: { fullName: "สมชาย" }, room };
    const result = await service.invite("raw-token");
    expect(db.roomInvite.findUnique.mock.calls[0][0].where.tokenHash).toBe(
      createHash("sha256").update("raw-token").digest("hex"),
    );
    expect(result.room.number).toBe("101");
    expect(result.residentHint).not.toBe("สมชาย");
  });
  it.each(["expired", "claimed", "revoked", "missing", "no-room"])(
    "invalid invite: %s",
    async (kind) => {
      if (kind === "expired") invite.expiresAt = new Date(0);
      if (kind === "claimed") invite.status = "CLAIMED";
      if (kind === "revoked") invite.status = "REVOKED";
      if (kind === "missing") db.roomInvite.findUnique.mockResolvedValue(null);
      if (kind === "no-room") invite.room = null;
      await expect(service.invite("token")).rejects.toThrow();
    },
  );
  it("vacant-room invite is single-use and creates a tenancy", async () => {
    const result = await service.claim("token", input);
    expect(result.accessToken).toBe("resident-jwt");
    expect(db.roomInvite.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "invite",
      status: "PENDING",
      expiresAt: { gt: expect.any(Date) },
    });
    expect(db.room.updateMany.mock.calls[0][0].where.status).toBe("VACANT");
    expect(db.resident.create).toHaveBeenCalledTimes(1);
  });
  it("concurrent invite claim loser does not create resident", async () => {
    db.roomInvite.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.claim("token", input)).rejects.toThrow("claimed");
    expect(db.resident.create).not.toHaveBeenCalled();
  });
  it("room changed from vacant cannot be claimed", async () => {
    db.room.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.claim("token", input)).rejects.toThrow("vacant");
    expect(db.resident.create).not.toHaveBeenCalled();
  });
  it("room invite rejects LINE account with existing active room", async () => {
    db.lineIdentity.findUnique.mockResolvedValue({
      resident: { contracts: [{ id: "active" }] },
    });
    await expect(service.claim("token", input)).rejects.toThrow("active room");
    expect(db.resident.create).not.toHaveBeenCalled();
  });
  it("contract invite links existing resident without creating a second tenancy", async () => {
    invite.contract = { room, resident, residentId: resident.id };
    const result = await service.claim("token", input);
    expect(result.resident.id).toBe("resident");
    expect(db.resident.create).not.toHaveBeenCalled();
    expect(db.contract.create).not.toHaveBeenCalled();
    expect(db.lineIdentity.upsert.mock.calls[0][0].where).toEqual({
      residentId: "resident",
    });
  });
  it("auth verifies against branch LIFF integration before issuing resident token", async () => {
    expect((await service.authenticate("token", "qa-liff")).accessToken).toBe(
      "resident-jwt",
    );
    expect(line.verifyIdToken).toHaveBeenCalledWith("integration", "token");
    expect(jwt.signAsync.mock.calls[0][0]).toMatchObject({
      sub: "resident",
      storeId: "store",
      branchId: "branch",
      type: "resident",
    });
  });
  it.each(["missing-integration", "unlinked", "deleted"])(
    "auth rejects %s",
    async (kind) => {
      if (kind === "missing-integration")
        db.lineIntegration.findFirst.mockResolvedValue(null);
      if (kind === "unlinked")
        db.lineIdentity.findFirst.mockResolvedValue(null);
      if (kind === "deleted") resident.deletedAt = new Date();
      await expect(service.authenticate("token", "qa-liff")).rejects.toThrow();
      expect(jwt.signAsync).not.toHaveBeenCalled();
    },
  );
  it("production mock-line token cannot skip verification", async () => {
    await expect(service.authenticate("mock-line:line")).rejects.toThrow(
      "not linked",
    );
    expect(db.lineIdentity.findUnique).not.toHaveBeenCalled();
  });
});
