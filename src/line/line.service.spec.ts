import { LineService } from "./line.service";
import { createHmac } from "crypto";
const user: any = {
  id: "staff",
  storeId: "store",
  allBranches: false,
  branchIds: ["branch"],
};
describe("LINE delivery, quota, identity and webhook workflows", () => {
  let db: any, service: LineService, fetchMock: jest.Mock;
  const originalFetch = global.fetch;
  beforeEach(() => {
    db = {
      lineIdentity: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "identity", lineUserId: "line" }),
      },
      lineIntegration: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: "integration",
            liffId: "qa-liff",
            miniAppChannelId: "12345",
            channelAccessTokenEncrypted: "token",
            messagingChannelSecretEncrypted: "secret",
          }),
      },
      resident: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: "resident",
            branchId: "branch",
            lineIdentity: { id: "identity" },
          }),
      },
      notificationLog: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) => Promise.resolve(data)),
      },
      chatMessage: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new LineService(
      db,
      { get: () => "production" } as never,
      { decrypt: (value: string) => value } as never,
    );
    fetchMock = jest
      .fn()
      .mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: { "x-line-request-id": "external" },
        }),
      );
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it("sends only to linked resident and logs delivery", async () => {
    const result = await service.sendToResident(
      "store",
      "branch",
      "resident",
      "staff-chat",
      { message: "test" },
    );
    expect(result.status).toBe("SENT");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toEqual({
      to: "line",
      messages: [{ type: "text", text: "test" }],
    });
    expect(result.externalId).toBe("external");
  });
  it.each([429, 500])("logs HTTP %s delivery failure", async (status) => {
    fetchMock.mockResolvedValue(new Response("{}", { status }));
    expect(
      (
        await service.sendToResident(
          "store",
          "branch",
          "resident",
          "staff-chat",
          { message: "test" },
        )
      ).status,
    ).toBe("FAILED");
  });
  it("logs network failure", async () => {
    fetchMock.mockRejectedValue(Error("offline"));
    expect(
      (
        await service.sendToResident(
          "store",
          "branch",
          "resident",
          "staff-chat",
          {},
        )
      ).errorCode,
    ).toBe("offline");
  });
  it("does not deliver when LINE integration is absent", async () => {
    db.lineIntegration.findFirst.mockResolvedValue(null);
    expect(
      (
        await service.sendToResident(
          "store",
          "branch",
          "resident",
          "staff-chat",
          {},
        )
      ).status,
    ).toBe("SKIPPED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("unlinked resident cannot receive messages", async () => {
    db.lineIdentity.findFirst.mockResolvedValue(null);
    await expect(
      service.sendToResident("store", "branch", "resident", "staff-chat", {}),
    ).rejects.toThrow("not linked");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("issued invoice has a single LIFF id and preserves fragment", async () => {
    await service.sendToResident(
      "store",
      "branch",
      "resident",
      "invoice-issued",
      {
        url: "https://miniapp.line.me/qa-liff/invoices/bill?liffId=qa-liff#detail",
        total: 5000,
      },
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    const uri = request.messages[0].contents.footer.contents[0].action.uri;
    const url = new URL(uri);
    expect(url.searchParams.getAll("liffId")).toEqual(["qa-liff"]);
    expect(url.hash).toBe("#detail");
  });
  it.each([true, false])(
    "approval message distinguishes fullyPaid=%s",
    async (fullyPaid) => {
      await service.sendToResident(
        "store",
        "branch",
        "resident",
        "payment-approved",
        { fullyPaid, remaining: 3000 },
      );
      const message = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0];
      expect(message.altText).toContain(fullyPaid ? "เรียบร้อย" : "บางส่วน");
    },
  );
  it("successful staff chat stores outbound history", async () => {
    await service.sendAsStaff(user, "resident", "staff-chat", {
      message: "hello",
    });
    expect(db.chatMessage.create.mock.calls[0][0].data).toMatchObject({
      direction: "OUTBOUND",
      text: "hello",
    });
  });
  it("failed staff chat does not invent sent history", async () => {
    fetchMock.mockRejectedValue(Error("offline"));
    await service.sendAsStaff(user, "resident", "staff-chat", {
      message: "hello",
    });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
  });
  it("staff cannot send to another branch", async () => {
    db.resident.findFirst.mockResolvedValue({ branchId: "other" });
    await expect(
      service.sendAsStaff(user, "resident", "staff-chat", {}),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("unlinked conversation returns empty history", async () => {
    db.resident.findFirst.mockResolvedValue({
      branchId: "branch",
      lineIdentity: null,
    });
    expect(await service.conversations(user, "resident")).toEqual([]);
    expect(db.chatMessage.findMany).not.toHaveBeenCalled();
  });
  it("linked conversation is ordered chronologically", async () => {
    await service.conversations(user, "resident");
    expect(db.chatMessage.findMany.mock.calls[0][0]).toEqual({
      where: { lineIdentityId: "identity" },
      orderBy: { createdAt: "asc" },
    });
  });
  it("webhook records only known integration text messages", async () => {
    await service.handleWebhook("integration", {
      events: [
        { type: "follow" },
        {
          type: "message",
          source: { userId: "line" },
          message: { type: "image" },
        },
        {
          type: "message",
          source: { userId: "line" },
          message: { id: "message", type: "text", text: "hello" },
        },
      ],
    });
    expect(db.chatMessage.create).toHaveBeenCalledTimes(1);
    expect(db.lineIdentity.findFirst.mock.calls[0][0].where).toEqual({
      lineUserId: "line",
      lineIntegrationId: "integration",
    });
  });
  it("unknown LINE identity webhook is ignored", async () => {
    db.lineIdentity.findFirst.mockResolvedValue(null);
    await service.handleWebhook("integration", {
      events: [
        {
          type: "message",
          source: { userId: "unknown" },
          message: { type: "text", text: "hello" },
        },
      ],
    });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
  });
  it("quota returns remaining messages and clamps zero", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith("/consumption") ? { totalUsage: 350 } : { value: 300 },
          ),
        ),
      ),
    );
    expect(await service.quota(user, "branch")).toEqual({
      configured: true,
      usage: 350,
      quota: 300,
      remaining: 0,
    });
  });
  it("quota missing configuration avoids external calls", async () => {
    db.lineIntegration.findFirst.mockResolvedValue(null);
    expect((await service.quota(user, "branch")).configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("quota reports upstream failure", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(service.quota(user, "branch")).rejects.toThrow("unavailable");
  });
  it("verifies webhook signature over exact raw body", async () => {
    const body = Buffer.from('{"events":[]}');
    const signature = createHmac("sha256", "secret")
      .update(body)
      .digest("base64");
    expect(await service.verifySignature("integration", body, signature)).toBe(
      true,
    );
    expect(
      await service.verifySignature(
        "integration",
        Buffer.from("changed"),
        signature,
      ),
    ).toBe(false);
  });
  it.each([undefined, "bad", "ก".repeat(44)])(
    "rejects malformed signature without throwing: %s",
    async (signature) => {
      expect(
        await service.verifySignature(
          "integration",
          Buffer.from("{}"),
          signature,
        ),
      ).toBe(false);
    },
  );
  it("verifies LINE ID token with correct channel", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ sub: "line", name: "test" })),
    );
    expect((await service.verifyIdToken("integration", "id-token")).sub).toBe(
      "line",
    );
    expect(fetchMock.mock.calls[0][1].body.get("client_id")).toBe("12345");
  });
  it.each([
    { status: 401, body: {} },
    { status: 200, body: {} },
  ])("rejects invalid LINE token %j", async (input) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(input.body), { status: input.status }),
    );
    await expect(
      service.verifyIdToken("integration", "id-token"),
    ).rejects.toThrow();
  });
  it("production never accepts mock-line as an authentication bypass", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(
      service.verifyIdToken("integration", "mock-line:line"),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalled();
  });
});
