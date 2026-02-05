"use server";

import { pool } from "@/src/lib/db";
import { requireAdmin } from "@/src/lib/admin";

export async function updateStory(formData: FormData) {
  requireAdmin();

  const id = formData.get("id")?.toString();
  if (!id) return;

  const status = formData.get("status")?.toString() ?? "active";
  const editorTitle = formData.get("editor_title")?.toString() ?? null;
  const editorSummary = formData.get("editor_summary")?.toString() ?? null;

  await pool.query(
    `update stories
     set status = $2,
         editor_title = $3,
         editor_summary = $4,
         updated_at = now()
     where id = $1`,
    [id, status, editorTitle && editorTitle.length > 0 ? editorTitle : null, editorSummary && editorSummary.length > 0 ? editorSummary : null]
  );
}

export async function mergeStory(formData: FormData) {
  requireAdmin();

  const sourceId = formData.get("source_id")?.toString();
  const targetId = formData.get("target_id")?.toString();

  if (!sourceId || !targetId || sourceId === targetId) return;

  await pool.query(
    `insert into story_articles (story_id, article_id, is_primary)
     select $2, article_id, false
     from story_articles
     where story_id = $1
     on conflict (story_id, article_id) do nothing`,
    [sourceId, targetId]
  );

  await pool.query(
    `update stories
     set last_seen_at = greatest(last_seen_at, (select last_seen_at from stories where id = $1)),
         updated_at = now()
     where id = $2`,
    [sourceId, targetId]
  );

  await pool.query("delete from stories where id = $1", [sourceId]);
}

export async function hideInternational(formData: FormData) {
  requireAdmin();

  const id = formData.get("id")?.toString();
  if (!id) return;

  await pool.query(
    `update stories
     set status = 'hidden',
         updated_at = now()
     where id = $1`,
    [id]
  );
}
