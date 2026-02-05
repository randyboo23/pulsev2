import { adminCookieName, adminCookieValue } from "@/src/lib/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const secret = formData.get("secret");
  const expected = process.env.ADMIN_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.redirect(new URL("/admin/login?error=1", request.url));
  }

  const response = NextResponse.redirect(new URL("/admin/stories", request.url));
  response.headers.append(
    "Set-Cookie",
    `${adminCookieName()}=${adminCookieValue()}; HttpOnly; Path=/; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}; Max-Age=${60 * 60 * 24 * 7}`
  );

  return response;
}

export async function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}
