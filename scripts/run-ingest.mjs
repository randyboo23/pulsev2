/**
 * Standalone ingest runner for GitHub Actions.
 * Calls ingestFeeds() directly — no HTTP layer, no Vercel timeout.
 *
 * Usage: npx tsx scripts/run-ingest.mjs
 * Requires: DATABASE_URL, ANTHROPIC_API_KEY, FIRECRAWL_API_KEY env vars
 */

import { ingestFeeds } from "../apps/web/src/lib/ingest.ts";

try {
  console.log("Starting ingest...");
  const result = await ingestFeeds();
  console.log("Ingest complete:");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.error("Ingest failed:", err);
  process.exit(1);
}
