import { pool } from "../apps/web/src/lib/db.ts";
import { evaluateStoryMergeDecision } from "../apps/web/src/lib/grouping.ts";
import { getNewsletterMenuStories, getTopStories } from "../apps/web/src/lib/stories.ts";

const DAYS_BACK = boundedInt(process.env.QA_NEWSLETTER_DAYS, 7, 3, 14);
const MENU_LIMIT = boundedInt(process.env.QA_NEWSLETTER_LIMIT, 30, 10, 50);
const HOMEPAGE_LIMIT = boundedInt(process.env.QA_HOMEPAGE_LIMIT, 20, 5, 30);
const RECENT_STORY_LIMIT = boundedInt(process.env.QA_NEWSLETTER_STORY_POOL_LIMIT, 400, 100, 800);
const STORY_REVIEW_LIMIT = boundedInt(process.env.QA_NEWSLETTER_SINGLE_SOURCE_REVIEW_LIMIT, 12, 5, 30);
const CANDIDATE_LIMIT = boundedInt(process.env.QA_NEWSLETTER_MERGE_CANDIDATE_LIMIT, 3, 1, 8);

function boundedInt(rawValue, fallback, min, max) {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function summarize(rows) {
  return {
    total: rows.length,
    single_source: rows.filter((row) => Number(row.source_count ?? 0) === 1).length,
    two_plus: rows.filter((row) => Number(row.source_count ?? 0) >= 2).length,
    three_plus: rows.filter((row) => Number(row.source_count ?? 0) >= 3).length,
    avg_source_count:
      rows.length === 0
        ? 0
        : Number(
            (
              rows.reduce((sum, row) => sum + Math.max(0, Number(row.source_count ?? 0)), 0) /
              rows.length
            ).toFixed(2)
          )
  };
}

function formatStoryRecord(story) {
  return {
    id: story.id,
    title: String(story.editor_title ?? story.title ?? "").trim(),
    editor_title: story.editor_title ?? null,
    editor_summary: story.editor_summary ?? null,
    last_seen_at: story.last_seen_at ?? story.latest_at ?? new Date(0).toISOString(),
    article_count: Math.max(1, Number(story.article_count ?? 1)),
    source_count: Math.max(0, Number(story.source_count ?? 0))
  };
}

function collectLikelyMatches(target, candidates) {
  const exact = [];
  const near = [];

  for (const candidate of candidates) {
    if (candidate.id === target.id) continue;

    const decision = evaluateStoryMergeDecision(target, candidate);
    const result = {
      story_id: candidate.id,
      title: candidate.title,
      source_count: candidate.source_count,
      ratio: Number(decision.details.ratio.toFixed(2)),
      shared_tokens: decision.details.sharedTokens,
      shared_action_tokens: decision.details.sharedActionTokens,
      shared_strong_tokens: decision.details.sharedStrongTokens,
      veto_reason: decision.vetoReason
    };

    if (decision.shouldMerge) {
      exact.push(result);
      continue;
    }

    const looksLikeNearMiss =
      !decision.vetoReason &&
      decision.details.ratio >= 0.3 &&
      decision.details.sharedStrongTokens >= 1 &&
      (decision.details.sharedActionTokens >= 1 || decision.details.sharedTokens >= 4);

    if (looksLikeNearMiss) {
      near.push(result);
    }
  }

  const byStrength = (left, right) =>
    right.ratio - left.ratio ||
    right.shared_strong_tokens - left.shared_strong_tokens ||
    right.shared_action_tokens - left.shared_action_tokens ||
    right.shared_tokens - left.shared_tokens;

  return {
    should_merge_now: exact.sort(byStrength).slice(0, CANDIDATE_LIMIT),
    near_miss: near.sort(byStrength).slice(0, CANDIDATE_LIMIT)
  };
}

const recentStoriesQuery = `
  select
    s.id,
    coalesce(s.editor_title, s.title) as title,
    s.editor_title,
    s.editor_summary,
    s.last_seen_at,
    count(sa.article_id)::int as article_count,
    count(
      distinct coalesce(
        src.domain,
        lower(nullif(split_part(regexp_replace(a.url, '^https?://', ''), '/', 1), ''))
      )
    )::int as source_count,
    max(coalesce(a.published_at, a.fetched_at)) as latest_at
  from stories s
  join story_articles sa on sa.story_id = s.id
  join articles a on a.id = sa.article_id
  left join sources src on src.id = a.source_id
  where coalesce(a.published_at, a.fetched_at) >= now() - make_interval(days => $1::int)
    and coalesce(a.quality_label, 'unknown') <> 'non_article'
    and coalesce(s.status, 'active') <> 'hidden'
  group by s.id
  order by max(coalesce(a.published_at, a.fetched_at)) desc
  limit $2
`;

const recentStoriesResult = await pool.query(recentStoriesQuery, [DAYS_BACK, RECENT_STORY_LIMIT]);
const recentStories = recentStoriesResult.rows.map(formatStoryRecord);
const recentStoryMap = new Map(recentStories.map((story) => [story.id, story]));

const menu = await getNewsletterMenuStories({
  menuId: "qa-newsletter-coverage",
  limit: MENU_LIMIT,
  daysBack: DAYS_BACK
});
const homepage = await getTopStories(HOMEPAGE_LIMIT);

const newsletterSingleSource = menu.stories
  .filter((story) => Number(story.source_count ?? 0) === 1)
  .slice(0, STORY_REVIEW_LIMIT);

const auditedStories = newsletterSingleSource.map((story) => {
  const target = recentStoryMap.get(story.id) ?? formatStoryRecord(story);
  const matches = collectLikelyMatches(target, recentStories);

  return {
    menu_rank: story.menu_rank,
    title: story.title,
    why_ranked: story.why_ranked,
    source_count: story.source_count,
    source_family_count: story.source_family_count,
    should_merge_now: matches.should_merge_now,
    near_miss: matches.near_miss
  };
});

const report = {
  window_days: DAYS_BACK,
  newsletter: summarize(menu.stories),
  homepage: summarize(homepage),
  story_pool: summarize(recentStories),
  audited_single_source_menu_stories: auditedStories
};

console.log(JSON.stringify(report, null, 2));
