import { redirect } from "next/navigation";
import { isAdmin } from "@/src/lib/admin";
import { pool } from "@/src/lib/db";
import { updateFeed, resetFeedFailures } from "./actions";

export const dynamic = "force-dynamic";

type FeedRow = {
  id: string;
  url: string;
  feed_type: "rss" | "scrape" | "discovery" | null;
  is_active: boolean;
  failure_count: number | null;
  last_error: string | null;
  last_success_at: string | null;
  source_name: string | null;
  domain: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export default async function AdminFeedsPage() {
  if (!isAdmin()) {
    redirect("/admin/login");
  }

  const result = await pool.query(
    `select f.id, f.url, f.feed_type, f.is_active, f.failure_count, f.last_error, f.last_success_at,
            s.name as source_name, s.domain
     from feeds f
     left join sources s on s.id = f.source_id
     order by f.failure_count desc, f.last_success_at desc nulls last`
  );
  const feeds = result.rows as FeedRow[];

  return (
    <main className="main">
      <header className="header">
        <div>
          <div className="brand">Pulse K-12</div>
          <div className="tagline">Admin · Feeds</div>
        </div>
        <div className="filters">
          <a className="filter" href="/admin/stories">Stories</a>
          <a className="filter" href="/admin/sources">Sources</a>
          <a className="filter" href="/">Home</a>
        </div>
      </header>

      <section className="card">
        <h2>Feed Health</h2>
        <p>Review failures and pause problematic feeds.</p>
        <div className="story-list">
          {feeds.map((feed) => (
            <div className="story" key={feed.id}>
              <div className="meta">
                {feed.source_name ?? "Unknown"} · {feed.domain ?? ""}
              </div>
              <div className="meta">Last success: {formatDate(feed.last_success_at)}</div>
              <div className="meta">Failures: {feed.failure_count}</div>
              {feed.last_error ? <div className="meta">Error: {feed.last_error}</div> : null}

              <form action={updateFeed} className="story-list">
                <input type="hidden" name="id" value={feed.id} />
                <label style={{ fontSize: "12px", color: "var(--muted)" }}>Feed URL</label>
                <input
                  type="text"
                  name="url"
                  defaultValue={feed.url}
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--border)" }}
                />
                <label style={{ fontSize: "12px", color: "var(--muted)" }}>Feed type</label>
                <select
                  name="feed_type"
                  defaultValue={feed.feed_type ?? "rss"}
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--border)" }}
                >
                  <option value="rss">rss</option>
                  <option value="scrape">scrape</option>
                  <option value="discovery">discovery</option>
                </select>
                <label style={{ fontSize: "12px", color: "var(--muted)" }}>
                  <input type="hidden" name="is_active" value="false" />
                  <input
                    type="checkbox"
                    name="is_active"
                    value="true"
                    defaultChecked={feed.is_active}
                    style={{ marginRight: "6px" }}
                  />
                  Active
                </label>
                <button className="filter" type="submit">Save</button>
              </form>

              <form action={resetFeedFailures} className="story-list" style={{ marginTop: "8px" }}>
                <input type="hidden" name="id" value={feed.id} />
                <button className="filter" type="submit">Reset failures</button>
              </form>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
