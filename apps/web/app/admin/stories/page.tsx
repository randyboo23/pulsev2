import { redirect } from "next/navigation";
import { isAdmin } from "@/src/lib/admin";
import { pool } from "@/src/lib/db";
import { updateStory, mergeStory, hideInternational } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminStoriesPage() {
  if (!isAdmin()) {
    redirect("/admin/login");
  }

  const result = await pool.query(
    `select
      s.id,
      s.story_key,
      s.title,
      s.summary,
      s.editor_title,
      s.editor_summary,
      s.status,
      s.last_seen_at,
      stats.article_count,
      stats.source_names,
      ta.top_articles
     from stories s
     left join (
       select
         sa.story_id,
         count(sa.article_id) as article_count,
         array_agg(distinct src.name) filter (where src.name is not null) as source_names
       from story_articles sa
       left join articles a on a.id = sa.article_id
       left join sources src on src.id = a.source_id
       group by sa.story_id
     ) stats on stats.story_id = s.id
     left join lateral (
       select json_agg(
         json_build_object(
           'title', a2.title,
           'url', a2.url,
           'source', src2.name
         )
       ) as top_articles
       from (
         select a1.id, a1.title, a1.url, a1.published_at, a1.fetched_at, a1.source_id
         from story_articles sa2
         join articles a1 on a1.id = sa2.article_id
         where sa2.story_id = s.id
         order by coalesce(a1.published_at, a1.fetched_at) desc
         limit 3
       ) a2
       left join sources src2 on src2.id = a2.source_id
     ) ta on true
    order by s.last_seen_at desc
    limit 200`
  );
  const stories = result.rows;

  let lastCleanup: string | undefined;
  let lastCleanupStats: { deleted_articles?: number; deleted_stories?: number } | undefined;
  try {
    const cleanupResult = await pool.query(
      `select created_at, detail
       from admin_events
       where event_type = 'cleanup_international'
       order by created_at desc
       limit 1`
    );
    lastCleanup = cleanupResult.rows[0]?.created_at as string | undefined;
    const detail = cleanupResult.rows[0]?.detail as
      | { deleted_articles?: number; deleted_stories?: number }
      | undefined;
    if (detail) {
      lastCleanupStats = {
        deleted_articles: Number(detail.deleted_articles ?? 0),
        deleted_stories: Number(detail.deleted_stories ?? 0)
      };
    }
  } catch {
    lastCleanup = undefined;
  }

  const candidates = [];
  const maxCandidates = 8;
  const windowDays = 4;
  const threshold = 0.6;

  function toTokens(storyKey: string | null) {
    if (!storyKey) return [];
    return storyKey.split("-").filter((token) => token.length > 0);
  }

  function jaccard(a: string[], b: string[]) {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) intersection += 1;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  const mergePool = stories.filter((story) => story.status !== "hidden");

  for (let i = 0; i < mergePool.length; i += 1) {
    for (let j = i + 1; j < mergePool.length; j += 1) {
      const a = mergePool[i];
      const b = mergePool[j];
      const aDate = new Date(a.last_seen_at);
      const bDate = new Date(b.last_seen_at);
      const daysApart = Math.abs(aDate.getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysApart > windowDays) continue;

      const overlap = jaccard(toTokens(a.story_key), toTokens(b.story_key));
      if (overlap < threshold) continue;

      const aCount = Number(a.article_count ?? 0);
      const bCount = Number(b.article_count ?? 0);
      const target = aCount > bCount || (aCount === bCount && aDate >= bDate) ? a : b;
      const source = target.id === a.id ? b : a;

      candidates.push({
        source,
        target,
        overlap
      });

      if (candidates.length >= maxCandidates) break;
    }
    if (candidates.length >= maxCandidates) break;
  }

  return (
    <main className="main">
      <header className="header">
        <div>
          <div className="brand">Pulse K-12</div>
          <div className="tagline">Admin · Stories</div>
        </div>
        <div className="filters">
          <a className="filter" href="/admin/sources">Sources</a>
          <a className="filter" href="/">Home</a>
        </div>
      </header>

      <section className="card">
        <h2>Stories</h2>
        <p>Adjust status, edit titles, or merge duplicates.</p>
        <div className="chips" style={{ marginTop: "12px" }}>
          <span className="chip">US-only filter enabled</span>
          <span className="chip">
            Last cleanup {lastCleanup ? new Date(lastCleanup).toLocaleString("en-US") : "never"}
          </span>
          {lastCleanupStats ? (
            <span className="chip">
              {lastCleanupStats.deleted_articles ?? 0} articles, {lastCleanupStats.deleted_stories ?? 0} stories removed
            </span>
          ) : null}
          <form action="/api/admin/cleanup-international" method="post">
            <button className="chip" type="submit">Re-run international cleanup</button>
          </form>
        </div>
        {candidates.length > 0 ? (
          <div className="story-list">
            <h3>Suggested merges</h3>
            {candidates.map((pair, index) => (
              <div className="story" key={`suggest-${index}`}>
                <div className="meta">Similarity {Math.round(pair.overlap * 100)}%</div>
                <div className="preview-list">
                  <div className="preview-item">
                    <strong>{pair.source.editor_title ?? pair.source.title}</strong>
                    <span>{pair.source.article_count ?? 0} sources</span>
                  </div>
                  <div className="preview-item">
                    <strong>{pair.target.editor_title ?? pair.target.title}</strong>
                    <span>{pair.target.article_count ?? 0} sources</span>
                  </div>
                </div>
                <form action={mergeStory} className="story-list">
                  <input type="hidden" name="source_id" value={pair.source.id} />
                  <input type="hidden" name="target_id" value={pair.target.id} />
                  <button className="filter" type="submit">
                    Merge into stronger story
                  </button>
                </form>
              </div>
            ))}
          </div>
        ) : null}
        <div className="story-list">
          {stories.map((story) => (
            <div className="story" key={story.id}>
              <div className="meta">
                Updated {new Date(story.last_seen_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric"
                })}{" "}
                · {story.article_count ?? 0} sources
              </div>
              {story.source_names?.length ? (
                <div className="meta">
                  {story.source_names.slice(0, 3).join(", ")}
                  {story.source_names.length > 3
                    ? ` +${story.source_names.length - 3} more`
                    : ""}
                </div>
              ) : null}
              {story.top_articles?.length ? (
                <div className="preview-list">
                  {story.top_articles.map((item, index) => (
                    <div className="preview-item" key={`${story.id}-preview-${index}`}>
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.title ?? "Untitled"}
                      </a>
                      <span>{item.source ?? "Unknown"}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="meta">
                <a href={`/stories/${story.id}`} className="admin-link">
                  View story
                </a>
              </div>
              <form action={updateStory} className="story-list">
                <input type="hidden" name="id" value={story.id} />
                <label style={{ fontSize: "12px", color: "var(--muted)" }}>Status</label>
                <select
                  name="status"
                  defaultValue={story.status ?? "active"}
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--border)" }}
                >
                  <option value="active">active</option>
                  <option value="pinned">pinned</option>
                  <option value="hidden">hidden</option>
                </select>
                <label style={{ fontSize: "12px", color: "var(--muted)" }}>Editor title</label>
                <input
                  type="text"
                  name="editor_title"
                  defaultValue={story.editor_title ?? ""}
                  placeholder={story.title}
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--border)" }}
                />
                <label style={{ fontSize: "12px", color: "var(--muted)" }}>Editor summary</label>
                <textarea
                  name="editor_summary"
                  defaultValue={story.editor_summary ?? ""}
                  placeholder={story.summary ?? ""}
                  rows={3}
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--border)" }}
                />
                <button className="filter" type="submit">Save</button>
              </form>

              <form action={hideInternational} className="story-list" style={{ marginTop: "8px" }}>
                <input type="hidden" name="id" value={story.id} />
                <button className="filter" type="submit">Hide as international</button>
              </form>

              <form action={mergeStory} className="story-list" style={{ marginTop: "12px" }}>
                <input type="hidden" name="source_id" value={story.id} />
                <label style={{ fontSize: "12px", color: "var(--muted)" }}>Merge into</label>
                <input
                  type="text"
                  name="target_id"
                  placeholder="Target story id"
                  list="story-ids"
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--border)" }}
                />
                <button className="filter" type="submit">Merge</button>
              </form>
            </div>
          ))}
        </div>
      </section>

      <datalist id="story-ids">
        {stories.map((story) => (
          <option key={`story-${story.id}`} value={story.id}>
            {story.title}
          </option>
        ))}
      </datalist>
    </main>
  );
}
