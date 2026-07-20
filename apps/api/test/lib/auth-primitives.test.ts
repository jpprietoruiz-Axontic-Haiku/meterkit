import { describe, expect, it } from "bun:test";
import { generateApiKey, hashApiKey } from "../../src/lib/api-key";
import { signAuthToken, verifyAuthToken } from "../../src/lib/jwt";
import { hashPassword, verifyPassword } from "../../src/lib/password";

describe("password hashing", () => {
  it("verifica correctamente un hash propio y rechaza contrasenas incorrectas", async () => {
    const hash = await hashPassword("correcthorsebattery");

    expect(await verifyPassword("correcthorsebattery", hash)).toBe(true);
    expect(await verifyPassword("otra-cosa", hash)).toBe(false);
  });
});

describe("JWT", () => {
  it("firma y verifica un token, preservando el payload", async () => {
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

  it("rechaza un token manipulado", async () => {
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
  it("genera claves unicas con hash reproducible y prefijo consistente", async () => {
    const a = await generateApiKey();
    const b = await generateApiKey();

    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.plaintext.startsWith(a.prefix)).toBe(true);
    expect(await hashApiKey(a.plaintext)).toBe(a.hash);
  });
});
