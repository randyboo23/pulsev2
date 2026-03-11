import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Audience, NewsletterLane, NewsletterStoryType } from "@pulse/core";
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

function parseOptionalBoundedInt(value: string | null, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, min), max);
}

function parseAudience(value: string | null): Audience | null {
  return value === "teachers" || value === "admins" || value === "edtech" ? value : null;
}

function parseLane(value: string | null): NewsletterLane | null {
  return value === "policy" || value === "classroom" || value === "edtech" || value === "leadership"
    ? value
    : null;
}

function parseStoryTypeList(values: string[]): NewsletterStoryType[] {
  const items = values
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(
    new Set(
      items.filter(
        (value): value is NewsletterStoryType =>
          value === "breaking" ||
          value === "policy" ||
          value === "feature" ||
          value === "evergreen" ||
          value === "opinion"
      )
    )
  );
}

function parseStoryIdList(values: string[]) {
  const items = values
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(
    new Set(
      items.filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    )
  );
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
  const audience = parseAudience(url.searchParams.get("audience"));
  const lane = parseLane(url.searchParams.get("lane"));
  const minSourceCount = parseOptionalBoundedInt(url.searchParams.get("min_source_count"), 1, 10);
  const excludeStoryIds = parseStoryIdList(url.searchParams.getAll("exclude_story_ids"));
  const excludeStoryTypes = parseStoryTypeList(url.searchParams.getAll("exclude_story_type"));

  try {
    const menu = await getNewsletterMenuStories({
      menuId: randomUUID(),
      limit,
      daysBack,
      audience,
      lane,
      minSourceCount,
      excludeStoryIds,
      excludeStoryTypes
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
