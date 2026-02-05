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
