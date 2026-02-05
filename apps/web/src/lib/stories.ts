import "server-only";
import { pool } from "./db";
import { scoreStory } from "./ranking";

export type StoryRow = {
  id: string;
  title: string;
  summary: string | null;
  editor_title?: string | null;
  editor_summary?: string | null;
  status?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  article_count: number;
  source_count: number;
  recent_count: number;
  avg_weight: number;
  latest_at: string;
  score: number;
};

export async function getTopStories(limit = 20): Promise<StoryRow[]> {
  const result = await pool.query(
    `select
      s.id,
      s.title,
      s.summary,
      s.editor_title,
      s.editor_summary,
      s.status,
      s.first_seen_at,
      s.last_seen_at,
      count(sa.article_id) as article_count,
      count(distinct a.source_id) as source_count,
      count(a.id) filter (where coalesce(a.published_at, a.fetched_at) >= now() - interval '24 hours') as recent_count,
      avg(coalesce(src.weight, 1.0)) as avg_weight,
      max(coalesce(a.published_at, a.fetched_at)) as latest_at
    from stories s
    join story_articles sa on sa.story_id = s.id
    join articles a on a.id = sa.article_id
    left join sources src on src.id = a.source_id
    group by s.id
    order by max(coalesce(a.published_at, a.fetched_at)) desc
    limit 200`
  );

  const scored = result.rows
    .filter((row) => row.status !== "hidden")
    .map((row) => {
    const score = scoreStory({
      title: row.editor_title ?? row.title,
      summary: row.editor_summary ?? row.summary,
      articleCount: Number(row.article_count),
      avgWeight: Number(row.avg_weight),
      latestAt: new Date(row.latest_at)
    });

    return {
      ...row,
      article_count: Number(row.article_count),
      source_count: Number(row.source_count),
      recent_count: Number(row.recent_count),
      avg_weight: Number(row.avg_weight),
      score
    };
  });

  const pinned = scored.filter((story) => story.status === "pinned");
  const rest = scored.filter((story) => story.status !== "pinned");

  return [
    ...pinned.sort((a, b) => b.score - a.score),
    ...rest.sort((a, b) => b.score - a.score)
  ].slice(0, limit);
}

export async function getStoryById(id: string) {
  const storyResult = await pool.query(
    `select id, title, summary, editor_title, editor_summary, status, first_seen_at, last_seen_at
     from stories
     where id = $1`,
    [id]
  );

  if (storyResult.rows.length === 0) {
    return null;
  }

  const articlesResult = await pool.query(
    `select
      a.id,
      a.title,
      a.summary,
      a.url,
      a.published_at,
      a.fetched_at,
      s.name as source_name
    from story_articles sa
    join articles a on a.id = sa.article_id
    left join sources s on s.id = a.source_id
    where sa.story_id = $1
    order by coalesce(a.published_at, a.fetched_at) desc`,
    [id]
  );

  return {
    story: storyResult.rows[0],
    articles: articlesResult.rows
  };
}
