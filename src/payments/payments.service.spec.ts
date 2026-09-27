import { PaymentsService } from "./payments.service";
const user: any = {
  id: "staff",
  storeId: "store",
  allBranches: false,
  branchIds: ["branch"],
};
describe("payment review workflow", () => {
  let service: PaymentsService, db: any, line: any, payment: any;
  beforeEach(() => {
    payment = {
      id: "pay",
      storeId: "store",
      branchId: "branch",
      invoiceId: "bill",
      status: "PENDING",
      amount: 2000,
      paidAt: new Date("2026-09-07"),
      invoice: {
        id: "bill",
        branchId: "branch",
        total: 5000,
        dueDate: new Date("2026-09-05"),
        room: { number: "101" },
        contract: { residentId: "resident" },
      },
    };
    db = {
      payment: {
        findFirst: jest.fn().mockResolvedValue(payment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...payment, status: "APPROVED" }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 2000 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      invoice: { findFirst: jest.fn(), update: jest.fn() },
      branch: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ lateFeePerDay: 10 }),
      },
      receipt: {
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(data)),
      },
      auditLog: { create: jest.fn() },
    };
    db.$transaction = jest.fn((fn: any) => fn(db));
    line = { sendToResident: jest.fn().mockResolvedValue({ status: "SENT" }) };
    service = new PaymentsService(db, line);
  });
  it("approves a partial amount, keeps balance, creates receipt and audit", async () => {
    const result = await service.approve(user, "pay");
    expect(result.invoiceStatus).toBe("PARTIALLY_PAID");
    expect(result.receipt).toMatchObject({
      amount: 2000,
      lateFee: 20,
      totalAmount: 2020,
    });
    expect(db.invoice.update.mock.calls[0][0].data.paidAt).toBeNull();
    expect(line.sendToResident.mock.calls[0][4]).toMatchObject({
      remaining: 3000,
      fullyPaid: false,
    });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it("marks a fully paid invoice and records paidAt", async () => {
    db.payment.aggregate.mockResolvedValue({ _sum: { amount: 5000 } });
    expect((await service.approve(user, "pay")).invoiceStatus).toBe("PAID");
    expect(db.invoice.update.mock.calls[0][0].data.paidAt).toBeInstanceOf(Date);
  });
  it("commits approval even when LINE delivery fails", async () => {
    line.sendToResident.mockRejectedValue(new Error("offline"));
    expect((await service.approve(user, "pay")).invoiceStatus).toBe(
      "PARTIALLY_PAID",
    );
    expect(db.receipt.create).toHaveBeenCalledTimes(1);
  });
  it.each(["APPROVED", "REJECTED"])(
    "cannot review %s twice",
    async (status) => {
      payment.status = status;
      await expect(service.approve(user, "pay")).rejects.toThrow("already");
      expect(db.receipt.create).not.toHaveBeenCalled();
    },
  );
  it("prevents a concurrent second approval", async () => {
    db.payment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve(user, "pay")).rejects.toThrow("already");
    expect(db.receipt.create).not.toHaveBeenCalled();
  });
  it("rejects access to another branch before changing payment", async () => {
    payment.branchId = "other";
    await expect(service.approve(user, "pay")).rejects.toThrow();
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });
  it("rejects missing payment", async () => {
    db.payment.findFirst.mockResolvedValue(null);
    await expect(service.approve(user, "missing")).rejects.toThrow("not found");
  });
  it("rejects pending slip with reason and audit", async () => {
    expect(await service.reject(user, "pay", "ยอดไม่ตรง")).toEqual({
      id: "pay",
      status: "REJECTED",
    });
    expect(db.payment.updateMany.mock.calls[0][0].data.rejectReason).toBe(
      "ยอดไม่ตรง",
    );
    expect(db.receipt.create).not.toHaveBeenCalled();
  });
  it("does not reject a previously reviewed slip", async () => {
    db.payment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reject(user, "pay", "reason")).rejects.toThrow(
      "already",
    );
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it("scopes pending list to store and allowed branch", async () => {
    await service.pending(user, "branch");
    expect(db.payment.findMany.mock.calls[0][0].where).toEqual({
      storeId: "store",
      branchId: "branch",
      status: "PENDING",
    });
    expect(() => service.pending(user, "other")).toThrow();
  });
  it("QR uses approved payments only to calculate balance", async () => {
    db.invoice.findFirst.mockResolvedValue({
      branchId: "branch",
      total: 5000,
      payments: [{ amount: 2000 }],
      branch: {
        promptPaySetting: {
          enabled: true,
          type: "PHONE",
          target: "0812345678",
          accountName: "QA",
        },
      },
    });
    const result = await service.qr(user, "bill");
    expect(result.amount).toBe(3000);
    expect(result.qrDataUrl).toMatch(/^data:image/);
    expect(
      db.invoice.findFirst.mock.calls[0][0].include.payments.where.status,
    ).toBe("APPROVED");
  });
  it.each(["missing", "unconfigured", "paid", "branch"])(
    "blocks %s QR",
    async (kind) => {
      const invoice: any = {
        branchId: "branch",
        total: 5000,
        payments: [],
        branch: {
          promptPaySetting: {
            enabled: true,
            type: "PHONE",
            target: "0812345678",
          },
        },
      };
      if (kind === "unconfigured")
        invoice.branch.promptPaySetting.enabled = false;
      if (kind === "paid") invoice.payments = [{ amount: 5000 }];
      if (kind === "branch") invoice.branchId = "other";
      db.invoice.findFirst.mockResolvedValue(
        kind === "missing" ? null : invoice,
      );
      await expect(service.qr(user, "bill")).rejects.toThrow();
    },
  );
});
