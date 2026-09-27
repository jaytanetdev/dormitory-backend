import { BillingService } from "./billing.service";
const user: any = {
  id: "staff",
  storeId: "store",
  allBranches: false,
  branchIds: ["branch"],
};
describe("billing and meter workflow", () => {
  let db: any, service: BillingService, line: any, dto: any;
  beforeEach(() => {
    db = {
      billingPeriod: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "period", dueDate: new Date("2026-09-05") }),
      },
      contract: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ roomId: "room", branch: { invoiceDueDays: 5 } }),
      },
      meterReading: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      invoice: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: "bill", ...data }),
          ),
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: "bill",
            status: "DRAFT",
            branchId: "branch",
            total: 5000,
            number: "INV-QA",
            dueDate: new Date("2026-09-05"),
            room: { number: "101" },
            branch: { lineIntegration: { liffId: "qa-liff" } },
            contract: { residentId: "resident" },
          }),
        update: jest.fn().mockResolvedValue({ id: "bill", status: "ISSUED" }),
      },
      auditLog: { create: jest.fn() },
    };
    db.$transaction = jest.fn((fn: any) => fn(db));
    line = { sendToResident: jest.fn().mockResolvedValue({ status: "SENT" }) };
    service = new BillingService(db, line, {
      get: () => "https://app.example.invalid",
    } as never);
    dto = {
      branchId: "branch",
      periodId: "period",
      contractId: "contract",
      number: "INV-QA",
      discount: 100,
      items: [
        { code: "RENT", description: "Rent", quantity: 1, unitPrice: 5000 },
        { code: "WATER", description: "Water", quantity: 10, unitPrice: 18 },
      ],
      meterReadings: [
        {
          type: "WATER",
          previousValue: 100,
          currentValue: 110,
          unitRate: 18,
          readingDate: "2026-09-01",
        },
      ],
    };
  });
  it("calculates rent plus utilities minus discount and records meter", async () => {
    const invoice = await service.createInvoice(user, dto);
    expect(invoice).toMatchObject({
      subtotal: 5180,
      total: 5080,
      discount: 100,
      roomId: "room",
    });
    expect(db.meterReading.create).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create).toHaveBeenCalled();
  });
  it("rounds each line to cents and never produces a negative total", async () => {
    dto.items = [
      { code: "RENT", description: "Rent", quantity: 3, unitPrice: 1.005 },
    ];
    dto.meterReadings = [];
    dto.discount = 100;
    const invoice = await service.createInvoice(user, dto);
    expect(invoice.subtotal).toBe(3.01);
    expect(invoice.total).toBe(0);
  });
  it.each(["missing-period", "inactive-contract"])(
    "rejects %s",
    async (kind) => {
      db[
        kind === "missing-period" ? "billingPeriod" : "contract"
      ].findFirst.mockResolvedValue(null);
      await expect(service.createInvoice(user, dto)).rejects.toThrow("Invalid");
    },
  );
  it.each([
    "backward",
    "missing-item",
    "quantity",
    "rate",
    "continuity",
    "date",
  ])("rejects invalid meter: %s", async (kind) => {
    if (kind === "backward") dto.meterReadings[0].currentValue = 99;
    if (kind === "missing-item") dto.items.pop();
    if (kind === "quantity") dto.items[1].quantity = 11;
    if (kind === "rate") dto.items[1].unitPrice = 19;
    if (kind === "continuity")
      db.meterReading.findFirst.mockResolvedValue({
        currentValue: 99,
        readingDate: new Date("2026-08-01"),
      });
    if (kind === "date")
      db.meterReading.findFirst.mockResolvedValue({
        currentValue: 100,
        readingDate: new Date("2026-09-01"),
      });
    await expect(service.createInvoice(user, dto)).rejects.toThrow();
    expect(db.invoice.create).not.toHaveBeenCalled();
  });
  it("issues draft and sends branch-specific invoice link", async () => {
    const result = await service.issueInvoice(user, "bill");
    expect(result.invoice.status).toBe("ISSUED");
    expect(line.sendToResident.mock.calls[0][4].url).toBe(
      "https://miniapp.line.me/qa-liff/invoices/bill?liffId=qa-liff",
    );
  });
  it("issuance succeeds when LINE is offline", async () => {
    line.sendToResident.mockRejectedValue(Error("offline"));
    expect((await service.issueInvoice(user, "bill")).invoice.status).toBe(
      "ISSUED",
    );
  });
  it.each(["ISSUED", "PAID", "VOID", "PARTIALLY_PAID", "OVERDUE"])(
    "cannot issue %s again",
    async (status) => {
      const i = await db.invoice.findFirst();
      i.status = status;
      await expect(service.issueInvoice(user, "bill")).rejects.toThrow(
        "Only draft",
      );
      expect(db.invoice.update).not.toHaveBeenCalled();
    },
  );
  it("cannot issue another branch invoice", async () => {
    const i = await db.invoice.findFirst();
    i.branchId = "other";
    await expect(service.issueInvoice(user, "bill")).rejects.toThrow();
    expect(db.invoice.update).not.toHaveBeenCalled();
  });
});
