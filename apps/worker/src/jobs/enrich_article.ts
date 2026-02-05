import { ArticleCandidate } from "@pulse/core";

export type EnrichmentResult = {
  winners: Record<string, string>;
  candidates: ArticleCandidate[];
  tldr?: string;
  vectorTldr?: string;
};

export async function enrichArticle(articleId: string): Promise<EnrichmentResult> {
  // TODO: pull RSS/metadata candidate
  // TODO: if low quality, fetch Firecrawl and/or Iframely
  // TODO: if still low quality, fallback to LLM grounded summary
  // TODO: select winners per field and persist
  return {
    winners: {},
    candidates: []
  };
}
