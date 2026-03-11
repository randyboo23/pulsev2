import "server-only";
import { pool } from "./db";
import { hasStrictK12TopicSignal } from "./k12-relevance";

export type ArticleRow = {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  published_at: string | null;
  fetched_at: string;
  source_name: string | null;
  relevance_score: number | null;
};

const GENERIC_WIRE_TITLE_PATTERNS = [
  /^brookings metro$/i,
  /^the hamilton project$/i,
  /^home$/i,
  /^about$/i,
  /^projects?$/i,
  /\bslug\s*permalinkurl\b/i,
  /\bcharacters?\s+or\s+less\b/i
];

function isGenericWireTitle(title: string) {
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (/^from\s+/i.test(trimmed)) return true;
  if (GENERIC_WIRE_TITLE_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (trimmed.length < 28 && words.length <= 4) return true;
  return false;
}

export async function getRecentArticles(limit = 50): Promise<ArticleRow[]> {
  const result = await pool.query<ArticleRow>(
    `select
      a.id,
      a.title,
      a.summary,
      a.url,
      a.published_at,
      a.fetched_at,
      s.name as source_name,
      a.relevance_score
    from articles a
    left join sources s on s.id = a.source_id
    where a.url not ilike '%/jobs/%'
      and a.url not ilike '%://jobs.%'
      and a.url not ilike '%/careers/%'
      and (a.title is null or a.title not ilike 'from %')
      and coalesce(a.quality_label, 'unknown') <> 'non_article'
      and a.url not ilike '%/profile/%'
      and a.url not ilike '%/profiles/%'
      and a.url not ilike '%/author/%'
      and a.url not ilike '%/authors/%'
      and a.url not ilike '%/about/%'
      and a.url not ilike '%/bio/%'
      and a.url not ilike '%/people/%'
      and a.url not ilike '%/person/%'
      and a.url not ilike '%/team/%'
      and a.url not ilike '%/experts/%'
      and a.url not ilike '%/expert/%'
      and a.url !~* 'https?://[^/]+/[a-z]{2,24}/?$'
    order by coalesce(a.published_at, a.fetched_at) desc
    limit $1`,
    [Math.max(limit * 5, limit)]
  );

  return result.rows
    .filter((row) => {
      const title = (row.title ?? "").trim();
      if (!title || isGenericWireTitle(title)) return false;

      const isApEducation = (row.source_name ?? "").toLowerCase() === "ap news education";
      if (!isApEducation) return true;

      const hasK12Signal = hasStrictK12TopicSignal({
        title: row.title,
        summary: row.summary,
        url: row.url
      });
      const score =
        typeof row.relevance_score === "number" && Number.isFinite(row.relevance_score)
          ? row.relevance_score
          : null;

      if (!hasK12Signal && (score === null || score < 0.5)) {
        return false;
      }

      return true;
    })
    .slice(0, limit);
}
