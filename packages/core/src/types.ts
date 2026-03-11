export type SourceTier = "A" | "B" | "C" | "unknown";

export type ArticleStatus = "new" | "enriched" | "blocked" | "error";

export type Audience = "teachers" | "admins" | "edtech";

export type ArticleCandidate = {
  provider: "rss" | "iframely" | "firecrawl" | "llm";
  title?: string;
  summary?: string;
  body?: string;
  imageUrl?: string;
  author?: string;
  canonicalUrl?: string;
  qualityScore?: number;
  raw?: Record<string, unknown>;
};

export type Article = {
  id: string;
  sourceId?: string | null;
  url: string;
  canonicalUrl?: string | null;
  title?: string | null;
  summary?: string | null;
  body?: string | null;
  imageUrl?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  fetchedAt: string;
  categoryHint?: string | null;
  sourceTier?: SourceTier;
  status: ArticleStatus;
  winnerMap?: Record<string, string> | null;
};

export type Story = {
  id: string;
  title: string;
  summary?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  gravityScore?: number | null;
  category?: string | null;
  status: "active" | "archived";
};

export type LocalTrend = {
  id: string;
  weekStart: string;
  topic: string;
  states: string[];
  confidence: number;
  summary: string;
};

export type NewsletterRankingReason =
  | "high_impact"
  | "policy"
  | "urgent"
  | "multi_source"
  | "district_impact"
  | "classroom_relevance"
  | "edtech"
  | "momentum";

export type NewsletterMenuArticle = {
  url: string;
  title: string | null;
  domain: string | null;
  source_name: string | null;
  published_at: string | null;
  is_primary: boolean;
};

export type NewsletterMenuStory = {
  menu_rank: number;
  newsletter_score: number;
  why_ranked: NewsletterRankingReason[];
  story_id: string;
  title: string;
  summary: string | null;
  preview_type: "full" | "excerpt" | "headline_only" | "synthetic" | null;
  preview_confidence: number | null;
  story_type: "breaking" | "policy" | "feature" | "evergreen" | "opinion";
  status: string | null;
  article_count: number;
  source_count: number;
  source_family_count: number;
  source_domains: string[];
  latest_at: string;
  homepage_rank: number | null;
  homepage_ranked_at: string | null;
  primary_article: NewsletterMenuArticle | null;
  supporting_articles: NewsletterMenuArticle[];
};

export type NewsletterMenuResponse = {
  menu_id: string;
  generated_at: string;
  ranking_version: string;
  window_days: number;
  limit: number;
  stories: NewsletterMenuStory[];
};
