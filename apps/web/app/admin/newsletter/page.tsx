import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import type { Audience, NewsletterLane, NewsletterRankingReason } from "@pulse/core";
import { isAdmin } from "@/src/lib/admin";
import {
  getNewsletterMenuStories,
  NEWSLETTER_MENU_DEFAULT_DAYS,
  NEWSLETTER_MENU_DEFAULT_LIMIT
} from "@/src/lib/stories";

export const dynamic = "force-dynamic";

type AdminNewsletterSearchParams = {
  days?: string | string[];
  limit?: string | string[];
  audience?: string | string[];
  lane?: string | string[];
  min_source_count?: string | string[];
  hide_features?: string | string[];
};

function readFirst(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function parseBoundedInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseOptionalBoundedInt(value: string | null, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, min), max);
}

function parseAudience(value: string | null): Audience | null {
  return value === "teachers" || value === "admins" || value === "edtech" ? value : null;
}

function parseLane(value: string | null): NewsletterLane | null {
  return value === "policy" || value === "classroom" || value === "edtech" || value === "leadership"
    ? value
    : null;
}

function parseBooleanFlag(value: string | null) {
  return value === "1" || value === "true" || value === "on";
}

function formatDateTime(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatReasonLabel(reason: NewsletterRankingReason) {
  switch (reason) {
    case "high_impact":
      return "High impact";
    case "policy":
      return "Policy";
    case "urgent":
      return "Urgent";
    case "multi_source":
      return "Multi-source";
    case "district_impact":
      return "District impact";
    case "classroom_relevance":
      return "Classroom relevance";
    case "edtech":
      return "EdTech";
    case "momentum":
      return "Momentum";
    default:
      return reason;
  }
}

function formatLabel(value: string) {
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildNewsletterHref(params: {
  days: number;
  limit: number;
  audience: Audience | null;
  lane: NewsletterLane | null;
  minSourceCount: number | null;
  hideFeatures: boolean;
}) {
  const search = new URLSearchParams();
  search.set("days", String(params.days));
  search.set("limit", String(params.limit));
  if (params.audience) search.set("audience", params.audience);
  if (params.lane) search.set("lane", params.lane);
  if (params.minSourceCount) search.set("min_source_count", String(params.minSourceCount));
  if (params.hideFeatures) search.set("hide_features", "1");
  return `/admin/newsletter?${search.toString()}`;
}

export default async function AdminNewsletterPage({
  searchParams
}: {
  searchParams?: AdminNewsletterSearchParams;
}) {
  if (!isAdmin()) {
    redirect("/admin/login");
  }

  const daysBack = parseBoundedInt(
    readFirst(searchParams?.days),
    NEWSLETTER_MENU_DEFAULT_DAYS,
    3,
    14
  );
  const limit = parseBoundedInt(
    readFirst(searchParams?.limit),
    NEWSLETTER_MENU_DEFAULT_LIMIT,
    10,
    50
  );
  const audience = parseAudience(readFirst(searchParams?.audience));
  const lane = parseLane(readFirst(searchParams?.lane));
  const minSourceCount = parseOptionalBoundedInt(readFirst(searchParams?.min_source_count), 1, 10);
  const hideFeatures = parseBooleanFlag(readFirst(searchParams?.hide_features));

  let menu: Awaited<ReturnType<typeof getNewsletterMenuStories>> | null = null;
  let loadError: string | null = null;

  try {
    menu = await getNewsletterMenuStories({
      menuId: randomUUID(),
      limit,
      daysBack,
      audience,
      lane,
      minSourceCount,
      excludeStoryTypes: hideFeatures ? ["feature"] : []
    });
  } catch (error) {
    console.error(
      `[admin/newsletter] failed to load menu: ${error instanceof Error ? error.message : String(error)}`
    );
    loadError = "The weekly menu could not be generated right now. Try again in a minute.";
  }

  const activeFilterStyle = {
    borderColor: "var(--accent)",
    color: "var(--accent)",
    background: "#fff7f7"
  } as const;
  const fieldStyle = {
    padding: "8px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "white"
  } as const;
  const quickLinks = [
    {
      label: "All lanes",
      href: buildNewsletterHref({
        days: daysBack,
        limit,
        audience,
        lane: null,
        minSourceCount,
        hideFeatures
      }),
      active: lane === null
    },
    {
      label: "Policy",
      href: buildNewsletterHref({
        days: daysBack,
        limit,
        audience,
        lane: "policy",
        minSourceCount,
        hideFeatures
      }),
      active: lane === "policy"
    },
    {
      label: "EdTech",
      href: buildNewsletterHref({
        days: daysBack,
        limit,
        audience,
        lane: "edtech",
        minSourceCount,
        hideFeatures
      }),
      active: lane === "edtech"
    },
    {
      label: "Classroom",
      href: buildNewsletterHref({
        days: daysBack,
        limit,
        audience,
        lane: "classroom",
        minSourceCount,
        hideFeatures
      }),
      active: lane === "classroom"
    },
    {
      label: "Leadership",
      href: buildNewsletterHref({
        days: daysBack,
        limit,
        audience,
        lane: "leadership",
        minSourceCount,
        hideFeatures
      }),
      active: lane === "leadership"
    },
    {
      label: "2+ Sources",
      href: buildNewsletterHref({
        days: daysBack,
        limit,
        audience,
        lane,
        minSourceCount: 2,
        hideFeatures
      }),
      active: minSourceCount === 2
    }
  ];

  return (
    <main className="main">
      <header className="header">
        <div>
          <div className="brand">Pulse K-12</div>
          <div className="tagline">Admin · Newsletter</div>
        </div>
        <div className="filters">
          <a className="filter" href="/admin/stories">Stories</a>
          <a className="filter" href="/admin/feeds">Feeds</a>
          <a className="filter" href="/admin/sources">Sources</a>
          <a className="filter" href="/admin/newsletter" style={activeFilterStyle}>Newsletter</a>
          <a className="filter" href="/">Home</a>
        </div>
      </header>

      <section className="card">
        <h2>Weekly Menu</h2>
        <p>
          Review the ranked weekly menu directly in admin. This page uses the server-side
          ranking logic, so the editor does not need API secrets or Cowork network access.
        </p>

        <form
          action="/admin/newsletter"
          method="get"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "12px",
            marginTop: "16px",
            alignItems: "end"
          }}
        >
          <label style={{ display: "grid", gap: "6px", fontSize: "12px", color: "var(--muted)" }}>
            Days
            <input type="number" name="days" min={3} max={14} defaultValue={daysBack} style={fieldStyle} />
          </label>
          <label style={{ display: "grid", gap: "6px", fontSize: "12px", color: "var(--muted)" }}>
            Stories
            <select name="limit" defaultValue={String(limit)} style={fieldStyle}>
              {[10, 20, 30, 40, 50].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: "6px", fontSize: "12px", color: "var(--muted)" }}>
            Audience
            <select name="audience" defaultValue={audience ?? ""} style={fieldStyle}>
              <option value="">All</option>
              <option value="teachers">Teachers</option>
              <option value="admins">Admins</option>
              <option value="edtech">EdTech</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: "6px", fontSize: "12px", color: "var(--muted)" }}>
            Lane
            <select name="lane" defaultValue={lane ?? ""} style={fieldStyle}>
              <option value="">All</option>
              <option value="policy">Policy</option>
              <option value="classroom">Classroom</option>
              <option value="edtech">EdTech</option>
              <option value="leadership">Leadership</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: "6px", fontSize: "12px", color: "var(--muted)" }}>
            Min sources
            <select name="min_source_count" defaultValue={minSourceCount ? String(minSourceCount) : ""} style={fieldStyle}>
              <option value="">Any</option>
              <option value="2">2+</option>
              <option value="3">3+</option>
            </select>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              color: "var(--muted)",
              minHeight: "38px"
            }}
          >
            <input type="checkbox" name="hide_features" value="1" defaultChecked={hideFeatures} />
            Hide feature stories
          </label>
          <button type="submit" className="admin-action">
            Refresh menu
          </button>
        </form>

        <div className="admin-action-row" style={{ marginTop: "12px" }}>
          {quickLinks.map((link) => (
            <a
              key={link.label}
              className="filter"
              href={link.href}
              style={link.active ? activeFilterStyle : undefined}
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="admin-inline-note">
          Use this page to review and shortlist stories. Drafting and Beehiiv export can stay in
          Cowork for now, but the menu pull itself is stable here.
        </div>
      </section>

      {loadError ? (
        <section className="card">
          <h2>Menu unavailable</h2>
          <p>{loadError}</p>
        </section>
      ) : menu ? (
        <>
          <section className="card">
            <h2>Menu snapshot</h2>
            <p>Generated {formatDateTime(menu.generated_at)} using ranking profile {menu.ranking_version}.</p>

            <div className="admin-stat-grid" style={{ marginTop: "12px" }}>
              <div className="admin-stat-card">
                <div className="admin-stat-label">Returned stories</div>
                <div className="admin-stat-value">{menu.pool_stats.returned_count}</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-label">Candidate pool</div>
                <div className="admin-stat-value">{menu.pool_stats.candidate_count}</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-label">After filters</div>
                <div className="admin-stat-value">{menu.pool_stats.filtered_count}</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-label">Multi-source in results</div>
                <div className="admin-stat-value">{menu.pool_stats.multi_source_returned}</div>
              </div>
            </div>

            <div className="admin-badge-row" style={{ marginTop: "12px" }}>
              <span className="admin-badge">Days: {daysBack}</span>
              <span className="admin-badge">Limit: {limit}</span>
              <span className="admin-badge">Lane: {lane ? formatLabel(lane) : "All"}</span>
              <span className="admin-badge">Audience: {audience ? formatLabel(audience) : "All"}</span>
              <span className="admin-badge">
                Min sources: {minSourceCount ? `${minSourceCount}+` : "Any"}
              </span>
              {hideFeatures ? <span className="admin-badge">Feature stories hidden</span> : null}
            </div>
          </section>

          <section className="card">
            <h2>Ranked stories</h2>
            <p>Primary links open the article the editor is most likely to read first.</p>
            <div className="story-list" style={{ marginTop: "16px" }}>
              {menu.stories.length === 0 ? (
                <div className="story">
                  <h3>No stories matched this filter set.</h3>
                  <p>Broaden the lane/source filters and try again.</p>
                </div>
              ) : (
                menu.stories.map((story) => (
                  <article className="story" key={story.story_id}>
                    <div className="meta">
                      #{story.menu_rank} · {formatLabel(story.story_type)} · {story.source_count} sources ·{" "}
                      {story.source_family_count} source families · Updated {formatDateTime(story.latest_at)}
                    </div>
                    <h3 style={{ marginTop: "8px" }}>
                      <a
                        href={story.primary_article?.url ?? `/stories/${story.story_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "inherit" }}
                      >
                        {story.title}
                      </a>
                    </h3>
                    {story.summary ? <p>{story.summary}</p> : <p>No summary available yet.</p>}

                    <div className="chips">
                      {story.why_ranked.map((reason) => (
                        <span className="chip" key={`${story.story_id}-${reason}`}>
                          {formatReasonLabel(reason)}
                        </span>
                      ))}
                      {story.matched_lanes.map((matchedLane) => (
                        <span className="chip" key={`${story.story_id}-${matchedLane}-lane`}>
                          {formatLabel(matchedLane)}
                        </span>
                      ))}
                      {story.homepage_rank ? (
                        <span className="chip">Homepage #{story.homepage_rank}</span>
                      ) : null}
                    </div>

                    <div className="admin-action-row" style={{ marginTop: "10px" }}>
                      <a
                        className="admin-link"
                        href={story.primary_article?.url ?? `/stories/${story.story_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open primary article
                      </a>
                      <a className="admin-link" href={`/stories/${story.story_id}`}>
                        View story detail
                      </a>
                    </div>

                    <div className="preview-list" style={{ marginTop: "12px" }}>
                      {story.primary_article ? (
                        <div className="preview-item">
                          <span>
                            Primary · {story.primary_article.source_name ?? story.primary_article.domain ?? "Unknown source"} ·{" "}
                            {formatDateTime(story.primary_article.published_at)}
                          </span>
                          <a
                            href={story.primary_article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--ink)", fontFamily: "var(--font-body)" }}
                          >
                            {story.primary_article.title ?? story.primary_article.url}
                          </a>
                        </div>
                      ) : null}
                      {story.supporting_articles.map((article) => (
                        <div className="preview-item" key={article.url}>
                          <span>
                            Supporting · {article.source_name ?? article.domain ?? "Unknown source"} ·{" "}
                            {formatDateTime(article.published_at)}
                          </span>
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--ink)", fontFamily: "var(--font-body)" }}
                          >
                            {article.title ?? article.url}
                          </a>
                        </div>
                      ))}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
