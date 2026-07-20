import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "../db/schema";
import { env } from "../env";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = "meterkit";
const EXPIRATION = "24h";

export type AuthTokenPayload = {
  sub: string;
  tenantId: string;
  role: UserRole;
  email: string;
};

export async function signAuthToken(payload: AuthTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(EXPIRATION)
    .sign(secret);
}

export async function verifyAuthToken(token: string): Promise<AuthTokenPayload> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.tenantId !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.email !== "string"
  ) {
    throw new Error("Invalid JWT payload");
  }

  return {
    sub: payload.sub,
    tenantId: payload.tenantId,
    role: payload.role as UserRole,
    email: payload.email,
  };
}
