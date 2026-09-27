import { MiniappService } from "./miniapp.service";
import type { ResidentUser } from "../common/request-user";

const resident: ResidentUser = {
  residentId: "resident-1",
  storeId: "store-1",
  branchId: "branch-1",
  lineUserId: "line-1",
};
const bill = (id: string, due: string, status = "ISSUED", approved = 0) => ({
  id,
  status,
  total: 5000,
  dueDate: new Date(due),
  payments: [
    { status: "APPROVED", amount: approved },
    { status: "PENDING", amount: 5000 },
  ],
});

describe("resident home billing flow", () => {
  function setup(invoices: ReturnType<typeof bill>[]) {
    const service = new MiniappService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(service, "me")
      .mockResolvedValue({ id: resident.residentId } as never);
    jest.spyOn(service, "invoices").mockResolvedValue(invoices as never);
    const detail = jest
      .spyOn(service, "invoice")
      .mockImplementation((_user, id) => Promise.resolve({ id }) as never);
    return { service, detail };
  }
  it("shows the oldest outstanding bill even when a newer bill is paid", async () => {
    const { service, detail } = setup([
      bill("latest-paid", "2026-09-30", "PAID", 5000),
      bill("partial", "2026-08-05", "PARTIALLY_PAID", 2000),
      bill("oldest-covered", "2026-07-05", "ISSUED", 5000),
    ]);
    expect((await service.home(resident)).invoice).toEqual({ id: "partial" });
    expect(detail).toHaveBeenCalledWith(resident, "partial");
  });
  it("keeps a bill with a pending slip outstanding until staff approval", async () => {
    const { service } = setup([bill("pending", "2026-08-05")]);
    expect((await service.home(resident)).invoice).toEqual({ id: "pending" });
  });
  it("returns an empty home without querying a missing invoice", async () => {
    const { service, detail } = setup([]);
    expect((await service.home(resident)).invoice).toBeNull();
    expect(detail).not.toHaveBeenCalled();
  });
  it("limits the invoice list to the resident and excludes draft and void bills", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new MiniappService(
      { invoice: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.invoices(resident);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: resident.storeId,
          branchId: resident.branchId,
          contract: { residentId: resident.residentId },
          status: { notIn: ["DRAFT", "VOID"] },
        },
      }),
    );
  });
});
