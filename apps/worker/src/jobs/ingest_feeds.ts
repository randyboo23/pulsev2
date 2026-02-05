import { TRUSTED_SITES } from "@pulse/core";

export async function ingestFeeds() {
  // TODO: fetch RSS feeds + Google News search queries
  // TODO: normalize articles, resolve canonical URLs, upsert into DB
  // NOTE: We will weight trusted sources higher during scoring.
  return {
    trustedCount: TRUSTED_SITES.length,
    ingested: 0
  };
}
