import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/admin";
import { pool } from "@/src/lib/db";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireAdmin();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const sqlPath = path.resolve(process.cwd(), "..", "..", "db", "cleanup_international.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const cleanupResult = await pool.query(sql);
  const stats = cleanupResult.rows?.[0] ?? {};
  try {
    await pool.query(
      "insert into admin_events (event_type, detail) values ($1, $2)",
      [
        "cleanup_international",
        {
          source: "admin_button",
          deleted_story_articles: Number(stats.deleted_story_articles ?? 0),
          deleted_articles: Number(stats.deleted_articles ?? 0),
          deleted_stories: Number(stats.deleted_stories ?? 0)
        }
      ]
    );
  } catch {
    // admin_events table might not exist yet; ignore.
  }

  return NextResponse.redirect(new URL("/admin/stories", request.url));
}

export async function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}
