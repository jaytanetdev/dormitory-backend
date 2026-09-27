import { LineCredentialsService } from "./line-credentials";
describe("encrypted LINE credential storage", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const service = new LineCredentialsService({
    getOrThrow: () => key,
  } as never);
  it("round-trips credentials without storing plaintext", () => {
    const encrypted = service.encrypt("secret-token");
    expect(encrypted).not.toContain("secret-token");
    expect(service.decrypt(encrypted)).toBe("secret-token");
  });
  it("uses a fresh nonce for repeated encryption", () => {
    expect(service.encrypt("same")).not.toBe(service.encrypt("same"));
  });
  it.each(["invalid", "v1.bad.bad.bad", "v2.bad.bad.bad"])(
    "rejects malformed ciphertext %s",
    (value) => {
      expect(() => service.decrypt(value)).toThrow();
    },
  );
  it("rejects tampered ciphertext", () => {
    const encrypted = service.encrypt("secret");
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => service.decrypt(parts.join("."))).toThrow();
  });
  it("requires a 32-byte encryption key", () => {
    const invalid = new LineCredentialsService({
      getOrThrow: () => Buffer.alloc(8).toString("base64"),
    } as never);
    expect(() => invalid.encrypt("secret")).toThrow("32-byte");
  });
});
