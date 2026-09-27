import { OperationsService } from "./operations.service";
const user: any = {
  id: "staff",
  storeId: "store",
  allBranches: false,
  branchIds: ["branch"],
};
describe("room and tenancy workflows", () => {
  let db: any, service: OperationsService, room: any, contract: any;
  beforeEach(() => {
    room = {
      id: "room",
      number: "101",
      status: "VACANT",
      building: { property: { branchId: "branch" } },
    };
    contract = {
      id: "contract",
      branchId: "branch",
      roomId: "room",
      status: "ACTIVE",
      startDate: new Date("2026-01-01"),
    };
    db = {
      room: { findFirst: jest.fn().mockResolvedValue(room), update: jest.fn() },
      resident: { findFirst: jest.fn().mockResolvedValue({ id: "resident" }) },
      contract: {
        findFirst: jest.fn().mockResolvedValue(contract),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(contract),
        update: jest.fn().mockResolvedValue({ ...contract, status: "ENDED" }),
      },
      lineIntegration: {
        findFirst: jest.fn().mockResolvedValue({ liffId: "qa-liff" }),
      },
      roomInvite: {
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: "invite" }),
      },
      auditLog: { create: jest.fn() },
      property: { findMany: jest.fn().mockResolvedValue([]) },
    };
    db.$transaction = jest.fn((fn: any) => fn(db));
    service = new OperationsService(db, {
      get: () => "https://app.example.invalid",
    } as never);
  });
  it("creates active tenancy and marks room occupied atomically", async () => {
    await service.createContract(user, {
      branchId: "branch",
      roomId: "room",
      residentId: "resident",
      startDate: "2026-01-01",
      monthlyRent: 5000,
      deposit: 5000,
      billingDay: 1,
    });
    expect(db.room.update).toHaveBeenCalledWith({
      where: { id: "room" },
      data: { status: "OCCUPIED" },
    });
    expect(db.auditLog.create).toHaveBeenCalled();
  });
  it("blocks a second active contract", async () => {
    db.contract.count.mockResolvedValue(1);
    await expect(
      service.createContract(user, {
        branchId: "branch",
        roomId: "room",
        residentId: "resident",
        startDate: "2026-01-01",
        monthlyRent: 5000,
        deposit: 0,
        billingDay: 1,
      }),
    ).rejects.toThrow("already");
    expect(db.contract.create).not.toHaveBeenCalled();
  });
  it("blocks branch mismatch", async () => {
    room.building.property.branchId = "other";
    await expect(
      service.createContract(user, {
        branchId: "branch",
        roomId: "room",
        residentId: "resident",
        startDate: "2026-01-01",
        monthlyRent: 5000,
        deposit: 0,
        billingDay: 1,
      }),
    ).rejects.toThrow("belong");
  });
  it("ends tenancy, frees room, preserves contract history and records audit", async () => {
    await service.setContractStatus(user, "contract", "ENDED", "2026-09-06");
    expect(db.contract.update.mock.calls[0][0].data).toEqual({
      status: "ENDED",
      endDate: new Date("2026-09-06"),
    });
    expect(db.room.update.mock.calls[0][0].data.status).toBe("VACANT");
    expect(db.auditLog.create.mock.calls[0][0].data.action).toBe(
      "contract.move_out",
    );
  });
  it("rejects move out before start", async () => {
    await expect(
      service.setContractStatus(user, "contract", "ENDED", "2025-12-31"),
    ).rejects.toThrow("before");
    expect(db.contract.update).not.toHaveBeenCalled();
  });
  it.each(["ENDED", "CANCELLED"])(
    "cannot move out a %s contract again",
    async (status) => {
      contract.status = status;
      await expect(
        service.setContractStatus(user, "contract", "ENDED"),
      ).rejects.toThrow("active");
    },
  );
  it("cannot move out another branch", async () => {
    contract.branchId = "other";
    await expect(
      service.setContractStatus(user, "contract", "ENDED"),
    ).rejects.toThrow();
    expect(db.contract.update).not.toHaveBeenCalled();
  });
  it("returns missing contract error", async () => {
    db.contract.findFirst.mockResolvedValue(null);
    await expect(
      service.setContractStatus(user, "missing", "ENDED"),
    ).rejects.toThrow("not found");
  });
  it("invite rotates prior links, stores hash, and targets branch LIFF", async () => {
    const result = await service.createRoomInvite(user, "room", {
      expiresInHours: 48,
    });
    expect(result.claimUrl).toMatch(
      new RegExp("^https://miniapp[.]line[.]me/qa-liff/claim/"),
    );
    expect(db.roomInvite.updateMany.mock.calls[0][0].data.status).toBe(
      "REVOKED",
    );
    expect(db.roomInvite.create.mock.calls[0][0].data.tokenHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(result).not.toHaveProperty("tokenHash");
  });
  it.each(["OCCUPIED", "RESERVED", "MAINTENANCE"])(
    "cannot invite a %s room",
    async (status) => {
      room.status = status;
      await expect(
        service.createRoomInvite(user, "room", { expiresInHours: 48 }),
      ).rejects.toThrow("vacant");
      expect(db.roomInvite.create).not.toHaveBeenCalled();
    },
  );
  it("requires branch LINE setup before invite", async () => {
    db.lineIntegration.findFirst.mockResolvedValue(null);
    await expect(
      service.createRoomInvite(user, "room", { expiresInHours: 48 }),
    ).rejects.toThrow("not configured");
  });
  it("scopes property lists to store and branch", async () => {
    await service.properties(user, "branch");
    expect(db.property.findMany.mock.calls[0][0].where).toEqual({
      storeId: "store",
      branchId: "branch",
      deletedAt: null,
    });
    expect(() => service.properties(user, "other")).toThrow();
  });
});
