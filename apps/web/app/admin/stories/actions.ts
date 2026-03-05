"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/src/lib/db";
import { requireAdmin } from "@/src/lib/admin";
import { sendSmtpTextEmail } from "@/src/lib/smtp";
import { getTopStories } from "@/src/lib/stories";

const GUARDRAIL_ALERT_EMAIL_SMTP_HOST = String(
  process.env.GUARDRAIL_ALERT_EMAIL_SMTP_HOST ?? "smtp.gmail.com"
).trim();
const GUARDRAIL_ALERT_EMAIL_SMTP_PORT = Number(process.env.GUARDRAIL_ALERT_EMAIL_SMTP_PORT ?? "465");
const GUARDRAIL_ALERT_EMAIL_SMTP_USER = String(process.env.GUARDRAIL_ALERT_EMAIL_SMTP_USER ?? "").trim();
const GUARDRAIL_ALERT_EMAIL_SMTP_PASS = String(process.env.GUARDRAIL_ALERT_EMAIL_SMTP_PASS ?? "")
  .replace(/\s+/g, "")
  .trim();
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
const LINKEDIN_TOP_STORY_EMAIL_RANK_LIMIT = Number(process.env.LINKEDIN_TOP_STORY_EMAIL_RANK_LIMIT ?? "10");
const LINKEDIN_TOP_STORY_EMAIL_MAX_SOURCE_NAMES = Number(
  process.env.LINKEDIN_TOP_STORY_EMAIL_MAX_SOURCE_NAMES ?? "3"
);

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

type StorySourceNameRow = {
  source_name: string | null;
};

function normalizeLinkedInLine(input: string | null | undefined) {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateLinkedInLine(input: string, max = 220) {
  if (input.length <= max) return input;
  const trimmed = input.slice(0, max).trim();
  const boundary = trimmed.lastIndexOf(" ");
  if (boundary > 60) return `${trimmed.slice(0, boundary).trim()}...`;
  return `${trimmed}...`;
}

function ensureSentence(input: string) {
  if (!input) return input;
  if (/[.!?]$/.test(input)) return input;
  return `${input}.`;
}

function formatSourceList(names: string[]) {
  if (names.length === 0) return "multiple national outlets";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function pickRelevantHashtags(text: string) {
  const normalized = text.toLowerCase();
  const tags = ["#K12Education", "#EducationNews", "#SchoolLeadership"];
  if (/\b(ai|technology|edtech|software|platform|cyber|data privacy)\b/.test(normalized)) {
    tags.push("#EdTech");
  } else if (/\b(policy|law|lawsuit|court|legislation|bill|board)\b/.test(normalized)) {
    tags.push("#EducationPolicy");
  } else if (/\b(classroom|teacher|curriculum|instruction|literacy|math|learning)\b/.test(normalized)) {
    tags.push("#TeachingAndLearning");
  } else if (/\b(superintendent|principal|district|budget|operations)\b/.test(normalized)) {
    tags.push("#DistrictLeadership");
  } else {
    tags.push("#EducationPolicy");
  }
  return tags.join(" ");
}

function buildLinkedInDraft(params: {
  title: string;
  summary: string | null;
  sourceCount: number;
  sourceNames: string[];
}) {
  const headline = ensureSentence(truncateLinkedInLine(normalizeLinkedInLine(params.title), 220));
  const summary = normalizeLinkedInLine(params.summary);
  const whyItMatters = ensureSentence(
    truncateLinkedInLine(
      summary ||
        "Multiple outlets are tracking this development, signaling broad impact for districts and school leaders.",
      170
    )
  );
  const hashtags = pickRelevantHashtags(`${params.title} ${params.summary ?? ""}`);

  return [
    `📊 ${params.sourceCount}+ outlets are reporting: ${headline}`,
    "",
    `What this means for K-12 leaders: ${whyItMatters}`,
    "",
    "📍 Follow stories like this and other trending K-12 stories at PulseK12.com, where headlines from major outlets update throughout the day.",
    "",
    `Reported by ${formatSourceList(params.sourceNames)}.`,
    "",
    hashtags
  ].join("\n");
}

async function loadStorySourceNames(storyId: string, limit: number) {
  try {
    const result = await pool.query<StorySourceNameRow>(
      `select src.name as source_name
       from story_articles sa
       join articles a on a.id = sa.article_id
       left join sources src on src.id = a.source_id
       where sa.story_id = $1
         and src.name is not null
       group by src.name
       order by max(coalesce(a.published_at, a.fetched_at)) desc
       limit $2`,
      [storyId, limit]
    );
    return result.rows
      .map((row) => String(row.source_name ?? "").trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
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

export async function sendTopStoryLinkedInDraftEmail() {
  requireAdmin();

  const sentAt = new Date().toISOString();
  const detailBase = {
    alertType: "linkedin_post_manual",
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

  try {
    const rankLimit = Math.max(1, Math.min(20, Math.floor(LINKEDIN_TOP_STORY_EMAIL_RANK_LIMIT)));
    const sourceNameLimit = Math.max(
      2,
      Math.min(6, Math.floor(LINKEDIN_TOP_STORY_EMAIL_MAX_SOURCE_NAMES))
    );
    const topStories = await getTopStories(Math.max(20, rankLimit), undefined, {
      useAiRerank: false,
      useStoredRank: true
    });
    const rankedWindow = topStories
      .filter((story) => story.status !== "hidden" && story.status !== "demoted")
      .slice(0, rankLimit);

    if (rankedWindow.length === 0) {
      await recordGuardrailEmailEvent({
        ...detailBase,
        sent: false,
        error: "no_top_stories_found"
      });
      revalidatePath("/admin/stories");
      return;
    }

    const selected = rankedWindow
      .map((story, index) => ({
        story,
        rank: index + 1,
        sourceCount: Math.max(0, Number(story.source_count ?? 0))
      }))
      .sort((a, b) => {
        if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount;
        return a.rank - b.rank;
      })[0];

    if (!selected) {
      await recordGuardrailEmailEvent({
        ...detailBase,
        sent: false,
        error: "no_eligible_story_found"
      });
      revalidatePath("/admin/stories");
      return;
    }

    const storyId = selected.story.id;
    const title = String(selected.story.editor_title ?? selected.story.title ?? "").trim();
    const summary =
      String(selected.story.editor_summary ?? selected.story.summary ?? "").trim() || null;
    const sourceNames = await loadStorySourceNames(storyId, sourceNameLimit);
    const draft = buildLinkedInDraft({
      title,
      summary,
      sourceCount: selected.sourceCount,
      sourceNames
    });

    const subject = `[PulseK12] LinkedIn draft (manual): #${selected.rank} (${selected.sourceCount} sources)`;
    const body = [
      "Manual LinkedIn draft requested from /admin/stories.",
      "",
      `Top rank: #${selected.rank}`,
      `Source count: ${selected.sourceCount}`,
      `Story: ${GUARDRAIL_ALERT_SITE_URL}/stories/${storyId}`,
      "",
      "Copy/paste LinkedIn post:",
      "",
      draft,
      "",
      `Generated at: ${sentAt}`
    ].join("\n");

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
      sent: true,
      storyId,
      rank: selected.rank,
      sourceCount: selected.sourceCount,
      sourceNames
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
