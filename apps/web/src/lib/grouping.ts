import "server-only";
import { pool } from "./db";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "for",
  "nor",
  "so",
  "yet",
  "to",
  "of",
  "in",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "into",
  "over",
  "after",
  "before",
  "about",
  "new",
  "report",
  "reports"
]);

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createStoryKey(title: string) {
  const tokens = normalizeTitle(title)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));

  const unique = Array.from(new Set(tokens));
  const trimmed = unique.slice(0, 8).sort();

  return trimmed.join("-");
}

async function findStoryByKey(storyKey: string) {
  const result = await pool.query(
    `select id from stories
     where story_key = $1
       and last_seen_at >= now() - interval '7 days'
     order by last_seen_at desc
     limit 1`,
    [storyKey]
  );

  return result.rows[0]?.id as string | undefined;
}

async function createStory(params: {
  storyKey: string;
  title: string;
  summary: string | null;
  timestamp: Date;
}) {
  const result = await pool.query(
    `insert into stories (story_key, title, summary, first_seen_at, last_seen_at)
     values ($1, $2, $3, $4, $4)
     returning id`,
    [params.storyKey, params.title, params.summary, params.timestamp]
  );

  return result.rows[0].id as string;
}

async function addArticleToStory(storyId: string, articleId: string, isPrimary: boolean) {
  await pool.query(
    `insert into story_articles (story_id, article_id, is_primary)
     values ($1, $2, $3)
     on conflict (story_id, article_id) do nothing`,
    [storyId, articleId, isPrimary]
  );
}

async function updateStoryTimestamp(storyId: string, timestamp: Date) {
  await pool.query(
    `update stories
     set last_seen_at = greatest(last_seen_at, $2),
         updated_at = now()
     where id = $1`,
    [storyId, timestamp]
  );
}

export async function groupUngroupedArticles() {
  const articlesResult = await pool.query(
    `select id, title, summary, published_at, fetched_at
     from articles
     where id not in (select article_id from story_articles)
     order by coalesce(published_at, fetched_at) desc
     limit 300`
  );

  let grouped = 0;

  for (const article of articlesResult.rows) {
    const title = article.title as string | null;
    if (!title) continue;

    const storyKey = createStoryKey(title);
    if (!storyKey) continue;

    const timestampValue = article.published_at ?? article.fetched_at;
    const timestamp = timestampValue ? new Date(timestampValue) : new Date();
    let storyId = await findStoryByKey(storyKey);

    let isPrimary = false;
    if (!storyId) {
      storyId = await createStory({
        storyKey,
        title,
        summary: article.summary ?? null,
        timestamp
      });
      isPrimary = true;
    }

    await addArticleToStory(storyId, article.id, isPrimary);
    await updateStoryTimestamp(storyId, timestamp);
    grouped += 1;
  }

  return grouped;
}
