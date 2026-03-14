"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Audience, NewsletterLane } from "@pulse/core";
import { requireAdmin } from "@/src/lib/admin";
import { pool } from "@/src/lib/db";

function parseUuid(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function parseUuidList(values: FormDataEntryValue[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    )
  );
}

function parseAudience(value: FormDataEntryValue | null): Audience | null {
  const normalized = String(value ?? "").trim();
  return normalized === "teachers" || normalized === "admins" || normalized === "edtech"
    ? normalized
    : null;
}

function parseLane(value: FormDataEntryValue | null): NewsletterLane | null {
  const normalized = String(value ?? "").trim();
  return normalized === "policy" ||
    normalized === "classroom" ||
    normalized === "edtech" ||
    normalized === "leadership"
    ? normalized
    : null;
}

function parseOptionalPositiveInt(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function parseBooleanFlag(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

function normalizeManualUrlList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/g)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => {
          try {
            const url = new URL(item);
            return url.protocol === "http:" || url.protocol === "https:";
          } catch {
            return false;
          }
        })
    )
  ).slice(0, 25);
}

function buildNewsletterAdminHref(params: {
  draftId: string | null;
  menuId: string | null;
  days: number | null;
  limit: number | null;
  audience: Audience | null;
  lane: NewsletterLane | null;
  minSourceCount: number | null;
  hideFeatures: boolean;
}) {
  const search = new URLSearchParams();
  if (params.draftId) search.set("draft_id", params.draftId);
  if (params.menuId) search.set("menu_id", params.menuId);
  if (params.days) search.set("days", String(params.days));
  if (params.limit) search.set("limit", String(params.limit));
  if (params.audience) search.set("audience", params.audience);
  if (params.lane) search.set("lane", params.lane);
  if (params.minSourceCount) search.set("min_source_count", String(params.minSourceCount));
  if (params.hideFeatures) search.set("hide_features", "1");
  const query = search.toString();
  return query ? `/admin/newsletter?${query}` : "/admin/newsletter";
}

function readNewsletterQuery(formData: FormData) {
  const draftId = parseUuid(formData.get("draft_id"));
  const menuId = parseUuid(formData.get("menu_id"));
  const days = parseOptionalPositiveInt(formData.get("days"));
  const limit = parseOptionalPositiveInt(formData.get("limit"));
  const audience = parseAudience(formData.get("audience"));
  const lane = parseLane(formData.get("lane"));
  const minSourceCount = parseOptionalPositiveInt(formData.get("min_source_count"));
  const hideFeatures = parseBooleanFlag(formData.get("hide_features"));
  return { draftId, menuId, days, limit, audience, lane, minSourceCount, hideFeatures };
}

export async function saveNewsletterDraft(formData: FormData) {
  requireAdmin();

  const query = readNewsletterQuery(formData);
  if (!query.draftId || !query.menuId) {
    redirect(buildNewsletterAdminHref(query));
  }

  const selectedStoryIds = parseUuidList(formData.getAll("selected_story_ids"));
  const selected = selectedStoryIds
    .map((storyId, index) => {
      const publishedRank = parseOptionalPositiveInt(formData.get(`story_rank:${storyId}`)) ?? index + 1;
      const title = String(formData.get(`story_title:${storyId}`) ?? "").trim() || null;
      return {
        story_id: storyId,
        published_rank: publishedRank,
        title
      };
    })
    .sort((left, right) => left.published_rank - right.published_rank || left.story_id.localeCompare(right.story_id))
    .map((item, index) => ({
      story_id: item.story_id,
      published_rank: index + 1,
      title: item.title
    }));

  const manualAddUrls = normalizeManualUrlList(String(formData.get("manual_add_urls") ?? ""));

  await pool.query(
    `insert into admin_events (event_type, detail)
     values ('newsletter_menu_feedback_draft', $1::jsonb)`,
    [
      JSON.stringify({
        source: "admin_newsletter",
        draft_id: query.draftId,
        menu_id: query.menuId,
        source_menu_id: query.menuId,
        query: {
          audience: query.audience,
          lane: query.lane,
          min_source_count: query.minSourceCount,
          hide_features: query.hideFeatures
        },
        selected_story_ids: selected.map((item) => item.story_id),
        selected,
        manual_add_urls: manualAddUrls
      })
    ]
  );

  revalidatePath("/admin/newsletter");
  redirect(buildNewsletterAdminHref(query));
}

export async function clearNewsletterDraft(formData: FormData) {
  requireAdmin();

  const query = readNewsletterQuery(formData);
  if (!query.draftId || !query.menuId) {
    redirect(buildNewsletterAdminHref(query));
  }

  await pool.query(
    `insert into admin_events (event_type, detail)
     values ('newsletter_menu_feedback_draft', $1::jsonb)`,
    [
      JSON.stringify({
        source: "admin_newsletter",
        draft_id: query.draftId,
        menu_id: query.menuId,
        source_menu_id: query.menuId,
        query: {
          audience: query.audience,
          lane: query.lane,
          min_source_count: query.minSourceCount,
          hide_features: query.hideFeatures
        },
        selected_story_ids: [],
        selected: [],
        manual_add_urls: []
      })
    ]
  );

  revalidatePath("/admin/newsletter");
  redirect(buildNewsletterAdminHref(query));
}
