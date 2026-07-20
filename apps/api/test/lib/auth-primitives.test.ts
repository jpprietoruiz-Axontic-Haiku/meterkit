import { describe, expect, it } from "bun:test";
import { generateApiKey, hashApiKey } from "../../src/lib/api-key";
import { signAuthToken, verifyAuthToken } from "../../src/lib/jwt";
import { hashPassword, verifyPassword } from "../../src/lib/password";

describe("password hashing", () => {
  it("correctly verifies its own hash and rejects incorrect passwords", async () => {
    const hash = await hashPassword("correcthorsebattery");

    expect(await verifyPassword("correcthorsebattery", hash)).toBe(true);
    expect(await verifyPassword("something-else", hash)).toBe(false);
  });
});

describe("JWT", () => {
  it("signs and verifies a token, preserving the payload", async () => {
    const token = await signAuthToken({
      sub: "user-1",
      tenantId: "tenant-1",
      role: "owner",
      email: "owner@test.com",
    });

    const payload = await verifyAuthToken(token);

    expect(payload).toEqual({
      sub: "user-1",
      tenantId: "tenant-1",
      role: "owner",
      email: "owner@test.com",
    });
  });

  it("rejects a tampered token", async () => {
    const token = await signAuthToken({
      sub: "user-1",
      tenantId: "tenant-1",
      role: "owner",
      email: "owner@test.com",
    });

    await expect(verifyAuthToken(`${token}tampered`)).rejects.toThrow();
  });
});

describe("API keys", () => {
  it("generates unique keys with a reproducible hash and consistent prefix", async () => {
    const a = await generateApiKey();
    const b = await generateApiKey();

    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.plaintext.startsWith(a.prefix)).toBe(true);
    expect(await hashApiKey(a.plaintext)).toBe(a.hash);
  });
});
