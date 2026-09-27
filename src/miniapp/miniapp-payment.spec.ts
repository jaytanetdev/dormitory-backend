import { MiniappService } from "./miniapp.service";
const user: any = {
  residentId: "resident",
  storeId: "store",
  branchId: "branch",
  lineUserId: "line",
};
describe("resident payment validation and isolation", () => {
  let db: any, service: MiniappService, invoice: any;
  beforeEach(() => {
    invoice = {
      id: "bill",
      total: 5000,
      payments: [{ status: "APPROVED", amount: 2000 }],
      branch: { code: "QA" },
      room: { number: "101" },
    };
    db = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue(invoice),
        findFirstOrThrow: jest.fn(),
      },
      payment: { create: jest.fn().mockResolvedValue({ id: "payment" }) },
    };
    service = new MiniappService(
      db,
      { get: () => undefined } as never,
      {} as never,
      {} as never,
    );
  });
  const dto = {
    invoiceId: "bill",
    amount: 3000,
    paidAt: "2026-09-06",
    fileUrl: "https://example.invalid/slip.png",
  };
  it("accepts exact outstanding amount and scopes payable lookup to resident", async () => {
    await service.payment(user, dto);
    expect(db.invoice.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "bill",
      storeId: "store",
      branchId: "branch",
      contract: { residentId: "resident" },
      status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
    });
    expect(db.payment.create.mock.calls[0][0].data.amount).toBe(3000);
  });
  it("blocks repeated payment while a slip awaits review", async () => {
    invoice.payments.push({ status: "PENDING", amount: 3000 });
    await expect(service.payment(user, dto)).rejects.toThrow("pending review");
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it("rejects amount exceeding approved-payment balance", async () => {
    await expect(
      service.payment(user, { ...dto, amount: 3001 }),
    ).rejects.toThrow("exceeds");
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it("cannot pay missing or another resident invoice", async () => {
    db.invoice.findFirst.mockResolvedValue(null);
    await expect(service.payment(user, dto)).rejects.toThrow("not found");
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it("scopes detail to resident and hides draft/void", async () => {
    await service.invoice(user, "bill");
    expect(db.invoice.findFirstOrThrow.mock.calls[0][0].where).toEqual({
      id: "bill",
      storeId: "store",
      branchId: "branch",
      contract: { residentId: "resident" },
      status: { notIn: ["DRAFT", "VOID"] },
    });
  });
  const file = {
    buffer: Buffer.from("png"),
    mimetype: "image/png",
    originalname: "slip.png",
    size: 3,
  };
  it("requires a slip image", async () => {
    await expect(
      service.uploadSlip(user, undefined, {
        invoiceId: "bill",
        amount: "3000",
        paidAt: "2026-09-06",
      }),
    ).rejects.toThrow("required");
  });
  it.each(["text/plain", "application/pdf", "image/svg+xml"])(
    "rejects MIME %s",
    async (mimetype) => {
      await expect(
        service.uploadSlip(
          user,
          { ...file, mimetype },
          { invoiceId: "bill", amount: "3000", paidAt: "2026-09-06" },
        ),
      ).rejects.toThrow("JPG");
      expect(db.invoice.findFirst).not.toHaveBeenCalled();
    },
  );
  it.each(["0", "-1", "NaN", "Infinity", "abc"])(
    "rejects amount %s before upload",
    async (amount) => {
      await expect(
        service.uploadSlip(user, file, {
          invoiceId: "bill",
          amount,
          paidAt: "2026-09-06",
        }),
      ).rejects.toThrow("invalid");
      expect(db.invoice.findFirst).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid transfer date", async () => {
    await expect(
      service.uploadSlip(user, file, {
        invoiceId: "bill",
        amount: "3000",
        paidAt: "not-date",
      }),
    ).rejects.toThrow("date is invalid");
  });
  it("rejects overpayment before calling Cloudinary", async () => {
    await expect(
      service.uploadSlip(user, file, {
        invoiceId: "bill",
        amount: "3001",
        paidAt: "2026-09-06",
      }),
    ).rejects.toThrow("exceeds");
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it("blocks duplicate slip before uploading to Cloudinary", async () => {
    invoice.payments.push({ status: "PENDING", amount: 3000 });
    await expect(
      service.uploadSlip(user, file, {
        invoiceId: "bill",
        amount: "3000",
        paidAt: "2026-09-06",
      }),
    ).rejects.toThrow("pending review");
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it("reports missing Cloudinary configuration without saving payment", async () => {
    await expect(
      service.uploadSlip(user, file, {
        invoiceId: "bill",
        amount: "3000",
        paidAt: "2026-09-06",
      }),
    ).rejects.toThrow("not configured");
    expect(db.payment.create).not.toHaveBeenCalled();
  });
});
