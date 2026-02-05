"use server";

import { pool } from "@/src/lib/db";
import { requireAdmin } from "@/src/lib/admin";

export async function updateFeed(formData: FormData) {
  requireAdmin();

  const id = formData.get("id")?.toString();
  if (!id) return;

  const url = formData.get("url")?.toString() ?? "";
  const feedType = formData.get("feed_type")?.toString() ?? "rss";
  const isActive = formData.get("is_active") === "true";

  await pool.query(
    `update feeds
     set url = $2,
         feed_type = $3,
         is_active = $4,
         updated_at = now()
     where id = $1`,
    [id, url, feedType, isActive]
  );
}

export async function resetFeedFailures(formData: FormData) {
  requireAdmin();

  const id = formData.get("id")?.toString();
  if (!id) return;

  await pool.query(
    `update feeds
     set failure_count = 0,
         last_error = null,
         updated_at = now()
     where id = $1`,
    [id]
  );
}
