import { AuthService } from "./auth.service";
import { compare } from "bcrypt";
jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue("hash"),
}));
describe("authentication and single-use refresh workflow", () => {
  const claims = { sub: "user", sid: "session", ver: 2, type: "refresh" };
  let service: AuthService, db: any, jwt: any;
  beforeEach(() => {
    jest.clearAllMocks();
    (compare as jest.Mock).mockResolvedValue(true);
    db = {
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: "user",
            tokenVersion: 2,
            passwordHash: "hash",
          }),
        update: jest.fn(),
      },
      refreshSession: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: "session",
            userId: "user",
            tokenHash: "hash",
            expiresAt: new Date(Date.now() + 60000),
            revokedAt: null,
            user: { status: "ACTIVE", deletedAt: null, tokenVersion: 2 },
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
    };
    jwt = {
      verifyAsync: jest.fn().mockResolvedValue(claims),
      signAsync: jest.fn().mockResolvedValue("signed"),
      decode: jest
        .fn()
        .mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    };
    service = new AuthService(db, jwt, {
      getOrThrow: () => "secret",
      get: (_key: string, fallback: string) => fallback,
    } as never);
  });
  it("normalizes login email and scopes lookup to active store/user", async () => {
    expect(
      await service.login({
        email: "USER@EXAMPLE.INVALID",
        password: "password",
        storeSlug: "demo",
      }),
    ).toMatchObject({ accessToken: "signed", expiresInSeconds: 900 });
    expect(db.user.findFirst.mock.calls[0][0].where).toMatchObject({
      email: "user@example.invalid",
      status: "ACTIVE",
      deletedAt: null,
      store: { slug: "demo", deletedAt: null },
    });
  });
  it("rejects bad passwords without issuing tokens", async () => {
    (compare as jest.Mock).mockResolvedValue(false);
    await expect(
      service.login({ email: "x", password: "bad", storeSlug: "demo" }),
    ).rejects.toThrow("Invalid credentials");
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
  it("rotates a refresh token exactly once", async () => {
    await service.refresh("raw");
    expect(db.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { id: "session", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(db.refreshSession.create).toHaveBeenCalledTimes(1);
  });
  it.each(["SUSPENDED", "INVITED"])("rejects %s users", async (status) => {
    db.refreshSession.findUnique.mock.results.length;
    const session = await db.refreshSession.findUnique();
    session.user.status = status;
    await expect(service.refresh("raw")).rejects.toThrow();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
  it.each(["deleted", "identity", "version", "expired", "revoked", "missing"])(
    "rejects %s refresh session",
    async (kind) => {
      const s = await db.refreshSession.findUnique();
      if (kind === "deleted") s.user.deletedAt = new Date();
      if (kind === "identity") s.userId = "other";
      if (kind === "version") s.user.tokenVersion = 3;
      if (kind === "expired") s.expiresAt = new Date(0);
      if (kind === "revoked") s.revokedAt = new Date();
      if (kind === "missing")
        db.refreshSession.findUnique.mockResolvedValue(null);
      await expect(service.refresh("raw")).rejects.toThrow();
    },
  );
  it("rejects the loser of simultaneous refresh rotation", async () => {
    db.refreshSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.refresh("raw")).rejects.toThrow("reused");
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
  it("rejects invalid signatures and access-token substitution", async () => {
    jwt.verifyAsync.mockRejectedValueOnce(new Error("signature"));
    await expect(service.refresh("bad")).rejects.toThrow("Invalid refresh");
    jwt.verifyAsync.mockResolvedValue({ ...claims, type: "access" });
    await expect(service.refresh("raw")).rejects.toThrow("Invalid token type");
  });
  it("logs out idempotently and scopes revocation to user", async () => {
    await service.logout("raw");
    expect(db.refreshSession.updateMany.mock.calls[0][0].where).toEqual({
      id: "session",
      userId: "user",
      revokedAt: null,
    });
    jwt.verifyAsync.mockRejectedValue(new Error("bad"));
    await expect(service.logout("bad")).resolves.toBeUndefined();
  });
});
