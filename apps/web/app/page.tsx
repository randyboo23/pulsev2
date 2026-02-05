import { getTopStories } from "@/src/lib/stories";
import { getRecentArticles } from "@/src/lib/articles";

export const dynamic = "force-dynamic";

function formatDate(dateString: string | null) {
  if (!dateString) return "Unknown date";
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(date);
}

function formatFullDate(dateString: string | null) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function getTodayDate() {
  return formatFullDate(new Date().toISOString());
}

function truncateHeadline(title: string, maxLength = 140) {
  const trimmed = title.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const cutoff = trimmed.slice(0, maxLength);
  const lastSpace = cutoff.lastIndexOf(" ");
  const safe = lastSpace > 60 ? cutoff.slice(0, lastSpace) : cutoff;
  return `${safe.trim()}…`;
}

export default async function HomePage({
  searchParams
}: {
  searchParams?: { audience?: string };
}) {
  const audience =
    searchParams?.audience === "teachers" ||
    searchParams?.audience === "admins" ||
    searchParams?.audience === "edtech"
      ? searchParams.audience
      : undefined;

  const stories = await getTopStories(18, audience);
  const articles = await getRecentArticles(12);

  const featuredStory = stories[0];
  const remainingStories = stories.slice(1);

  return (
    <>
      {/* Masthead */}
      <header className="masthead">
        <div className="masthead-date">{getTodayDate()}</div>
        <h1 className="masthead-brand">Pulse K-12</h1>
        <p className="masthead-tagline">The Signal in Education News</p>
      </header>

      {/* Navigation */}
      <nav className="nav-bar">
        <a href="/" className="nav-link active">Top Stories</a>
        <a href="/" className="nav-link">Policy</a>
        <a href="/" className="nav-link">Classroom</a>
        <a href="/" className="nav-link">EdTech</a>
        <a href="/" className="nav-link">Leadership</a>
        <a href="/newsletter" className="nav-link">Newsletter</a>
      </nav>

      {/* Newsletter Signup Bar */}
      <div className="newsletter-bar">
        <div className="newsletter-bar-inner">
          <div className="newsletter-bar-text">
            <span className="newsletter-bar-label">Free Newsletter</span>
            <span className="newsletter-bar-pitch">
              <strong>The weekly briefing</strong> for K-12 leaders
            </span>
          </div>
          <form className="newsletter-bar-form" action="/api/newsletter/subscribe" method="POST">
            <input
              type="email"
              name="email"
              className="newsletter-bar-input"
              placeholder="Enter your email"
              required
            />
            <button type="submit" className="newsletter-bar-button">
              Subscribe
            </button>
          </form>
        </div>
      </div>

      <main className="main">
        <div className="audience-filters">
          <span className="audience-label">Audience:</span>
          <a className={`audience-link ${!audience ? "active" : ""}`} href="/">
            All
          </a>
          <a
            className={`audience-link ${audience === "teachers" ? "active" : ""}`}
            href="/?audience=teachers"
          >
            Teachers
          </a>
          <a
            className={`audience-link ${audience === "admins" ? "active" : ""}`}
            href="/?audience=admins"
          >
            Admins
          </a>
          <a
            className={`audience-link ${audience === "edtech" ? "active" : ""}`}
            href="/?audience=edtech"
          >
            EdTech
          </a>
        </div>
        {/* Featured Story */}
        {featuredStory ? (
          <article className="featured-story">
            <div className="featured-kicker">Lead Story</div>
            <h2 className="featured-headline">
              <a href={`/stories/${featuredStory.id}`}>
                {truncateHeadline(featuredStory.editor_title ?? featuredStory.title, 120)}
              </a>
            </h2>
            {(featuredStory.editor_summary ?? featuredStory.summary) && (
              <p className="featured-summary">
                {featuredStory.editor_summary ?? featuredStory.summary}
              </p>
            )}
            <div className="featured-meta">
              <span className="featured-meta-item">
                {featuredStory.source_count} sources reporting
              </span>
              <span className="featured-meta-item">
                {featuredStory.recent_count} updates in 24h
              </span>
              <span className="featured-meta-item">
                Updated {formatDate(featuredStory.last_seen_at)}
              </span>
            </div>
          </article>
        ) : (
          <div className="empty-state">
            <h2 className="empty-state-title">No stories yet</h2>
            <p className="empty-state-text">Run the ingest endpoint to load stories.</p>
          </div>
        )}

        {/* Section Header */}
        <div className="section-header">
          <span className="section-title">Today&apos;s Coverage</span>
        </div>

        {/* Main Content Grid */}
        <div className="story-grid">
          {/* Main Column - Top Stories */}
          <div className="story-column-main">
            <div className="story-list">
              {remainingStories.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-state-text">More stories will appear here.</p>
                </div>
              ) : (
                remainingStories.slice(0, 8).map((story, index) => (
                  <article className="story-item" key={story.id}>
                    <span className="story-item-number">{index + 2}</span>
                    <h3 className="story-headline">
                      <a href={`/stories/${story.id}`}>
                        {truncateHeadline(story.editor_title ?? story.title, 120)}
                      </a>
                    </h3>
                    {(story.editor_summary ?? story.summary) && (
                      <p className="story-excerpt">
                        {story.editor_summary ?? story.summary}
                      </p>
                    )}
                    <div className="story-meta">
                      <span className="story-stat">
                        {story.source_count} outlets
                      </span>
                      <span className="story-stat">
                        {story.recent_count} in 24h
                      </span>
                      <span className="story-stat">
                        Updated {formatDate(story.last_seen_at)}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>

          {/* Sidebar - Latest Wire */}
          <aside className="story-column-side">
            <h2 className="wire-header">Latest Wire</h2>
            <div className="story-list">
              {articles.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-state-text">No recent articles.</p>
                </div>
              ) : (
                articles.map((article) => (
                  <div className="wire-item" key={`wire-${article.id}`}>
                    <h3 className="wire-headline">
                      <a href={article.url} target="_blank" rel="noreferrer">
                        {article.title ?? "Untitled"}
                      </a>
                    </h3>
                    <span className="wire-source">
                      {article.source_name ?? "Unknown"} · {formatDate(article.published_at)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
