import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "pulse_admin";

function getAdminSecret() {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SECRET is not set");
  }
  return secret;
}

function hashSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function adminCookieValue() {
  return hashSecret(getAdminSecret());
}

export function isAdmin() {
  const value = cookies().get(COOKIE_NAME)?.value;
  return value === adminCookieValue();
}

export function adminCookieName() {
  return COOKIE_NAME;
}

export function requireAdmin() {
  if (!isAdmin()) {
    throw new Error("Unauthorized");
  }
}
