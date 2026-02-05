import "server-only";
import { pool } from "./db";

export type ArticleRow = {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  published_at: string | null;
  fetched_at: string;
  source_name: string | null;
};

export async function getRecentArticles(limit = 50): Promise<ArticleRow[]> {
  const result = await pool.query<ArticleRow>(
    `select
      a.id,
      a.title,
      a.summary,
      a.url,
      a.published_at,
      a.fetched_at,
      s.name as source_name
    from articles a
    left join sources s on s.id = a.source_id
    order by coalesce(a.published_at, a.fetched_at) desc
    limit $1`,
    [limit]
  );

  return result.rows;
}
