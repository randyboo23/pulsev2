"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/src/lib/db";
import { requireAdmin } from "@/src/lib/admin";
import { sendSmtpTextEmail } from "@/src/lib/smtp";

const GUARDRAIL_ALERT_EMAIL_SMTP_HOST = String(
  process.env.GUARDRAIL_ALERT_EMAIL_SMTP_HOST ?? "smtp.gmail.com"
).trim();
const GUARDRAIL_ALERT_EMAIL_SMTP_PORT = Number(process.env.GUARDRAIL_ALERT_EMAIL_SMTP_PORT ?? "465");
const GUARDRAIL_ALERT_EMAIL_SMTP_USER = String(process.env.GUARDRAIL_ALERT_EMAIL_SMTP_USER ?? "").trim();
const GUARDRAIL_ALERT_EMAIL_SMTP_PASS = String(process.env.GUARDRAIL_ALERT_EMAIL_SMTP_PASS ?? "").trim();
const GUARDRAIL_ALERT_EMAIL_FROM = String(
  process.env.GUARDRAIL_ALERT_EMAIL_FROM || GUARDRAIL_ALERT_EMAIL_SMTP_USER
).trim();
const GUARDRAIL_ALERT_EMAIL_TO = String(process.env.GUARDRAIL_ALERT_EMAIL_TO ?? "")
  .split(/[;,]/)
  .map((value) => value.trim())
  .filter(Boolean);
const GUARDRAIL_ALERT_EMAIL_EHLO = String(process.env.GUARDRAIL_ALERT_EMAIL_EHLO ?? "pulsek12.com").trim();
const GUARDRAIL_ALERT_SITE_URL = String(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://pulsek12.com"
).replace(/\/+$/, "");

async function recordGuardrailEmailEvent(detail: Record<string, unknown>) {
  try {
    await pool.query(
      `insert into admin_events (event_type, detail)
       values ('ingest_guardrail_email', $1::jsonb)`,
      [JSON.stringify(detail)]
    );
  } catch {
    // Keep admin action resilient if logging fails.
  }
}

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

export async function demoteStory(formData: FormData) {
  requireAdmin();

  const id = formData.get("id")?.toString();
  if (!id) return;

  await pool.query(
    `update stories
     set status = 'demoted',
         updated_at = now()
     where id = $1`,
    [id]
  );
}

export async function sendGuardrailTestEmail() {
  requireAdmin();

  const sentAt = new Date().toISOString();
  const detailBase = {
    alertType: "top_story_duplicate_test",
    to: GUARDRAIL_ALERT_EMAIL_TO,
    sentAt
  };

  if (
    !GUARDRAIL_ALERT_EMAIL_SMTP_HOST ||
    !Number.isFinite(GUARDRAIL_ALERT_EMAIL_SMTP_PORT) ||
    GUARDRAIL_ALERT_EMAIL_SMTP_PORT <= 0 ||
    !GUARDRAIL_ALERT_EMAIL_SMTP_USER ||
    !GUARDRAIL_ALERT_EMAIL_SMTP_PASS ||
    !GUARDRAIL_ALERT_EMAIL_FROM ||
    GUARDRAIL_ALERT_EMAIL_TO.length === 0
  ) {
    await recordGuardrailEmailEvent({
      ...detailBase,
      sent: false,
      error: "missing_smtp_config"
    });
    revalidatePath("/admin/stories");
    return;
  }

  const subject = "[PulseK12] Guardrail email test";
  const body = [
    "This is a test guardrail email from Pulse K-12.",
    "",
    `Admin panel: ${GUARDRAIL_ALERT_SITE_URL}/admin/stories`,
    `Sent at: ${sentAt}`
  ].join("\n");

  try {
    await sendSmtpTextEmail({
      host: GUARDRAIL_ALERT_EMAIL_SMTP_HOST,
      port: Math.floor(GUARDRAIL_ALERT_EMAIL_SMTP_PORT),
      username: GUARDRAIL_ALERT_EMAIL_SMTP_USER,
      password: GUARDRAIL_ALERT_EMAIL_SMTP_PASS,
      from: GUARDRAIL_ALERT_EMAIL_FROM,
      to: GUARDRAIL_ALERT_EMAIL_TO,
      subject,
      text: body,
      ehloHost: GUARDRAIL_ALERT_EMAIL_EHLO
    });
    await recordGuardrailEmailEvent({
      ...detailBase,
      sent: true
    });
  } catch (error) {
    await recordGuardrailEmailEvent({
      ...detailBase,
      sent: false,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    revalidatePath("/admin/stories");
  }
}
