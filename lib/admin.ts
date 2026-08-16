import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "snapextract_admin";
const TTL_SECONDS = 60 * 60 * 24 * 7;

function secret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-only-change-me";
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

export function createSession() {
  const payload = `${Date.now()}:${crypto.randomBytes(16).toString("hex")}`;
  return `${payload}.${sign(payload)}`;
}

export function isValidSession(value?: string) {
  if (!value) return false;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const age = Date.now() - Number(payload.split(":")[0]);
  if (!Number.isFinite(age) || age < 0 || age > TTL_SECONDS * 1000) return false;
  const expected = sign(payload);
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function requireAdmin() {
  const store = await cookies();
  return isValidSession(store.get(COOKIE)?.value);
}

export const adminCookie = {
  name: COOKIE,
  maxAge: TTL_SECONDS,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/"
};
