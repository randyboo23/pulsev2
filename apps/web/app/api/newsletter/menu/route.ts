import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isSecretAuthorized } from "@/src/lib/request-auth";
import {
  getNewsletterMenuStories,
  NEWSLETTER_MENU_DEFAULT_DAYS,
  NEWSLETTER_MENU_DEFAULT_LIMIT,
  recordNewsletterMenuSnapshot
} from "@/src/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBoundedInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isAuthorized(request: Request) {
  return isSecretAuthorized(request, {
    headerSecrets: [
      {
        headerName: "x-newsletter-secret",
        secret: process.env.NEWSLETTER_SECRET
      }
    ],
    bearerSecrets: [process.env.NEWSLETTER_SECRET]
  });
}

export async function GET(request: Request) {
  if (!process.env.NEWSLETTER_SECRET) {
    return NextResponse.json(
      { error: "Newsletter menu is not configured." },
      { status: 503 }
    );
  }

  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const limit = parseBoundedInt(url.searchParams.get("limit"), NEWSLETTER_MENU_DEFAULT_LIMIT, 10, 50);
  const daysBack = parseBoundedInt(url.searchParams.get("days"), NEWSLETTER_MENU_DEFAULT_DAYS, 3, 14);

  try {
    const menu = await getNewsletterMenuStories({
      menuId: randomUUID(),
      limit,
      daysBack
    });
    await recordNewsletterMenuSnapshot(menu);
    return NextResponse.json(menu);
  } catch (error) {
    console.error(
      `[newsletter] menu generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return NextResponse.json(
      { error: "Newsletter menu generation failed." },
      { status: 500 }
    );
  }
}
