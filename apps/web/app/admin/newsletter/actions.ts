"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type {
  Audience,
  NewsletterDraftDetail,
  NewsletterDraftSelection,
  NewsletterGeneratedBlurb,
  NewsletterLane
} from "@pulse/core";
import { requireAdmin } from "@/src/lib/admin";
import { pool } from "@/src/lib/db";
import {
  buildNewsletterDraftBlurbKey,
  generateNewsletterDraftBlurbs
} from "@/src/lib/newsletter-blurbs";

type DraftEventRow = {
  detail: NewsletterDraftDetail | null;
};

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

function parseOptionalPositiveInt(value: FormDataEntryValue | string | number | null | undefined) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function parseBooleanFlag(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

function normalizeOptionalText(value: FormDataEntryValue | string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeOptionalUrl(value: FormDataEntryValue | string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeManualUrlList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/g)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => normalizeOptionalUrl(item))
        .filter((item): item is string => Boolean(item))
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

function parseSelectedStories(formData: FormData): NewsletterDraftSelection[] {
  const selectedStoryIds = parseUuidList(formData.getAll("selected_story_ids"));

  return selectedStoryIds
    .map((storyId, index) => {
      const publishedRank = parseOptionalPositiveInt(formData.get(`story_rank:${storyId}`)) ?? index + 1;
      return {
        story_id: storyId,
        published_rank: publishedRank,
        title: normalizeOptionalText(formData.get(`story_title:${storyId}`)),
        summary: normalizeOptionalText(formData.get(`story_summary:${storyId}`)),
        source_url: normalizeOptionalUrl(formData.get(`story_source_url:${storyId}`)),
        source_name: normalizeOptionalText(formData.get(`story_source_name:${storyId}`))
      };
    })
    .sort((left, right) => left.published_rank - right.published_rank || left.story_id.localeCompare(right.story_id))
    .map((item, index) => ({
      ...item,
      published_rank: index + 1
    }));
}

function normalizeGeneratedBlurbs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const kind = item && typeof item === "object" && item.kind === "manual" ? "manual" : "story";
      const url = normalizeOptionalUrl(item && typeof item === "object" ? (item as { url?: string }).url : null) ?? "";
      const storyId =
        item && typeof item === "object"
          ? parseUuid(((item as { story_id?: string | null }).story_id ?? null) as FormDataEntryValue | null)
          : null;
      const valueForKey = kind === "story" ? storyId : url;
      if (!valueForKey) return null;
      return {
        key:
          normalizeOptionalText(item && typeof item === "object" ? (item as { key?: string }).key : null) ??
          buildNewsletterDraftBlurbKey(kind, valueForKey),
        kind,
        story_id: storyId,
        published_rank:
          item && typeof item === "object"
            ? parseOptionalPositiveInt((item as { published_rank?: number | null }).published_rank ?? null)
            : null,
        url,
        title: normalizeOptionalText(item && typeof item === "object" ? (item as { title?: string | null }).title : null),
        source_name: normalizeOptionalText(
          item && typeof item === "object" ? (item as { source_name?: string | null }).source_name : null
        ),
        headline: normalizeOptionalText(
          item && typeof item === "object" ? (item as { headline?: string | null }).headline : null
        ),
        summary: normalizeOptionalText(
          item && typeof item === "object" ? (item as { summary?: string | null }).summary : null
        ),
        error: normalizeOptionalText(item && typeof item === "object" ? (item as { error?: string | null }).error : null),
        generated_at:
          normalizeOptionalText(
            item && typeof item === "object" ? (item as { generated_at?: string | null }).generated_at : null
          ) ?? new Date(0).toISOString()
      } satisfies NewsletterGeneratedBlurb;
    })
    .filter((item): item is NewsletterGeneratedBlurb => Boolean(item));
}

function filterGeneratedBlurbsToCurrent(
  blurbs: NewsletterGeneratedBlurb[],
  selected: NewsletterDraftSelection[],
  manualAddUrls: string[]
) {
  const activeKeys = new Set<string>([
    ...selected.map((item) => buildNewsletterDraftBlurbKey("story", item.story_id)),
    ...manualAddUrls.map((url) => buildNewsletterDraftBlurbKey("manual", url))
  ]);

  return blurbs.filter((item) => activeKeys.has(item.key));
}

async function loadExistingDraftDetail(draftId: string | null) {
  if (!draftId) return null;

  const result = await pool.query<DraftEventRow>(
    `select detail
     from admin_events
     where event_type = 'newsletter_menu_feedback_draft'
       and detail->>'draft_id' = $1
     order by created_at desc
     limit 1`,
    [draftId]
  );

  return result.rows[0]?.detail ?? null;
}

function buildDraftDetail(params: {
  query: ReturnType<typeof readNewsletterQuery>;
  formData: FormData;
  existingGeneratedBlurbs?: NewsletterGeneratedBlurb[];
  generatedBlurbs?: NewsletterGeneratedBlurb[];
}): NewsletterDraftDetail {
  const selected = parseSelectedStories(params.formData);
  const manualAddUrls = normalizeManualUrlList(String(params.formData.get("manual_add_urls") ?? ""));
  const blurbs = filterGeneratedBlurbsToCurrent(
    params.generatedBlurbs ?? params.existingGeneratedBlurbs ?? [],
    selected,
    manualAddUrls
  );

  return {
    source: "admin_newsletter",
    draft_id: params.query.draftId ?? undefined,
    menu_id: params.query.menuId ?? undefined,
    source_menu_id: params.query.menuId ?? undefined,
    query: {
      audience: params.query.audience,
      lane: params.query.lane,
      min_source_count: params.query.minSourceCount,
      hide_features: params.query.hideFeatures
    },
    selected_story_ids: selected.map((item) => item.story_id),
    selected,
    manual_add_urls: manualAddUrls,
    generated_blurbs: blurbs
  };
}

async function persistDraftDetail(detail: NewsletterDraftDetail) {
  await pool.query(
    `insert into admin_events (event_type, detail)
     values ('newsletter_menu_feedback_draft', $1::jsonb)`,
    [JSON.stringify(detail)]
  );
}

export async function saveNewsletterDraft(formData: FormData) {
  requireAdmin();

  const query = readNewsletterQuery(formData);
  if (!query.draftId || !query.menuId) {
    redirect(buildNewsletterAdminHref(query));
  }

  const existingDetail = await loadExistingDraftDetail(query.draftId);
  const detail = buildDraftDetail({
    query,
    formData,
    existingGeneratedBlurbs: normalizeGeneratedBlurbs(existingDetail?.generated_blurbs)
  });

  await persistDraftDetail(detail);
  revalidatePath("/admin/newsletter");
  redirect(buildNewsletterAdminHref(query));
}

export async function generateNewsletterBlurbs(formData: FormData) {
  requireAdmin();

  const query = readNewsletterQuery(formData);
  if (!query.draftId || !query.menuId) {
    redirect(buildNewsletterAdminHref(query));
  }

  const existingDetail = await loadExistingDraftDetail(query.draftId);
  const detail = buildDraftDetail({
    query,
    formData,
    existingGeneratedBlurbs: normalizeGeneratedBlurbs(existingDetail?.generated_blurbs)
  });

  const selected = Array.isArray(detail.selected) ? detail.selected : [];
  const manualAddUrls = Array.isArray(detail.manual_add_urls) ? detail.manual_add_urls : [];
  const generatedBlurbs = await generateNewsletterDraftBlurbs({
    selected,
    manualAddUrls
  });

  await persistDraftDetail(
    buildDraftDetail({
      query,
      formData,
      generatedBlurbs
    })
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

  await persistDraftDetail({
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
    manual_add_urls: [],
    generated_blurbs: []
  });

  revalidatePath("/admin/newsletter");
  redirect(buildNewsletterAdminHref(query));
}
