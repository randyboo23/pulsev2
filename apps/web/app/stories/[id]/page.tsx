import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStoryById, type StoryArticleRow } from "@/src/lib/stories";

export async function generateMetadata({
  params
}: {
  params: { id: string };
}): Promise<Metadata> {
  const result = await getStoryById(params.id);
  if (!result) return {};

  const title = result.story.editor_title ?? result.story.title;
  const description =
    result.story.editor_summary ??
    result.story.summary ??
    "Coverage from multiple sources on Pulse K-12.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article"
    },
    twitter: {
      card: "summary_large_image",
      title,
      description
    }
  };
}

function formatDate(dateString: string | null) {
  if (!dateString) return "Unknown date";
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatShortDate(dateString: string | null) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(date);
}

function dedupeArticles(articles: StoryArticleRow[]) {
  const seen = new Map<string, boolean>();
  return articles.filter((article) => {
    // Dedupe by exact URL
    const normalUrl = article.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(normalUrl)) return false;
    seen.set(normalUrl, true);

    // Dedupe by source + similar headline (same source, titles differ only by casing/punctuation)
    const sourceKey = (article.source_name ?? "").toLowerCase();
    const titleKey = (article.title ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const dedupKey = `${sourceKey}::${titleKey}`;
    if (seen.has(dedupKey)) return false;
    seen.set(dedupKey, true);

    return true;
  });
}

export default async function StoryPage({
  params
}: {
  params: { id: string };
}) {
  const result = await getStoryById(params.id);

  if (!result) {
    notFound();
  }

  const { story, articles: rawArticles } = result;
  const articles = dedupeArticles(rawArticles);
  const title = story.editor_title ?? story.title;
  const summary =
    story.editor_summary ??
    story.summary ??
    articles.find((article) => article.summary)?.summary ??
    null;

  return (
    <>
      {/* Minimal masthead for detail page */}
      <header className="masthead">
        <h1 className="masthead-brand">Pulse K-12</h1>
      </header>

      <main>
        {/* Article Header */}
        <header className="article-header">
          <a href="/" className="article-back">
            Back to Headlines
          </a>
          <div className="article-kicker">Story Brief</div>
          <h1 className="article-title">{title}</h1>
          {summary && (
            <p className="article-summary">{summary}</p>
          )}
        </header>

        {/* Meta Bar */}
        <div className="article-meta-bar">
          <span>Last updated {formatDate(story.last_seen_at)}</span>
          <span>{articles.length} sources</span>
        </div>

        {/* Sources Section */}
        <section className="sources-section">
          <h2 className="sources-header">
            Coverage from {articles.length} {articles.length === 1 ? "Source" : "Sources"}
          </h2>

          <div className="story-list">
            {articles.map((article) => (
              <article className="source-item" key={article.id}>
                <div className="source-outlet">
                  {article.source_name ?? "Unknown Outlet"}
                </div>
                <h3 className="source-headline">
                  <a href={article.url} target="_blank" rel="noreferrer">
                    {article.title ?? "Untitled"}
                  </a>
                </h3>
                <div className="source-date">
                  {formatShortDate(article.published_at)}
                </div>
                {articles.length > 1 && article.summary && (
                  <p className="source-summary">{article.summary}</p>
                )}
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
