/**
 * Autenticación local compatible con Supabase Auth (GoTrue).
 *
 * Reproduce el contrato que consume `supabase-js`: alta con email, login con
 * contraseña, refresh de token, actualización de contraseña y un "OAuth" de
 * demostración. Los tokens son JWT HS256 firmados acá mismo y el `sub` viaja
 * en `request.jwt.claims`, que es lo que leen `auth.uid()` y las políticas RLS.
 *
 * Es un entorno de DESARROLLO: en producción estos endpoints son los de
 * Supabase (mismo contrato, otra implementación).
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const JWT_SECRET = process.env.LOCAL_JWT_SECRET ?? "casoratti-local-dev-secret";
export const ANON_KEY = process.env.LOCAL_ANON_KEY ?? "local-anon-key";
export const SERVICE_ROLE_KEY = process.env.LOCAL_SERVICE_ROLE_KEY ?? "local-service-role-key";

export type TokenPayload = {
  sub: string;
  email?: string;
  role: string;
  aud: string;
  exp: number;
  iat: number;
  session_id?: string;
};

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function signJwt(payload: Omit<TokenPayload, "iat" | "exp"> & { exp?: number }): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const body: TokenPayload = {
    ...payload,
    aud: payload.aud ?? "authenticated",
    iat: issuedAt,
    exp: payload.exp ?? issuedAt + 3600,
  };
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify(body));
  const signature = base64Url(
    createHmac("sha256", JWT_SECRET).update(`${header}.${claims}`).digest(),
  );
  return `${header}.${claims}.${signature}`;
}

export function verifyJwt(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, claims, signature] = parts;
  const expected = base64Url(
    createHmac("sha256", JWT_SECRET).update(`${header}.${claims}`).digest(),
  );
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(claims, "base64").toString()) as TokenPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Hash de contraseña con scrypt. No se guarda el texto plano. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = scryptSync(password, salt, 64).toString("hex");
  if (derived.length !== hash.length) return false;
  return timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

export type AuthUser = {
  id: string;
  email: string;
  created_at: string;
  confirmed_at: string | null;
  raw_user_meta_data: Record<string, unknown>;
};

export function publicUser(user: AuthUser): Record<string, unknown> {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: user.confirmed_at,
    phone: "",
    confirmed_at: user.confirmed_at,
    last_sign_in_at: user.created_at,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: user.raw_user_meta_data,
    identities: [],
    created_at: user.created_at,
    updated_at: user.created_at,
  };
}

export function sessionResponse(user: AuthUser, sessionId: string) {
  const accessToken = signJwt({
    sub: user.id,
    email: user.email,
    role: "authenticated",
    aud: "authenticated",
    session_id: sessionId,
  });
  const refreshToken = signJwt({
    sub: user.id,
    email: user.email,
    role: "authenticated",
    aud: "authenticated",
    session_id: sessionId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  });
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;

  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    provider_refresh_token: null,
    user: publicUser(user),
  };
}
