/**
 * One-time duplicate story merge runner.
 *
 * Usage:
 * node --conditions react-server --import tsx/esm scripts/run-merge-stories.mjs
 *
 * Optional env vars:
 * - MERGE_LOOKBACK_DAYS (default 45)
 * - MERGE_CANDIDATE_LIMIT (default 500)
 * - MERGE_MAX (default 250)
 * - MERGE_SIMILARITY (default 0.56)
 * - MERGE_DRY_RUN (default false)
 */

import { mergeSimilarStories } from "../apps/web/src/lib/grouping.ts";

function toInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

const options = {
  lookbackDays: toInt(process.env.MERGE_LOOKBACK_DAYS, 45),
  candidateLimit: toInt(process.env.MERGE_CANDIDATE_LIMIT, 500),
  maxMerges: toInt(process.env.MERGE_MAX, 250),
  similarityThreshold: toFloat(process.env.MERGE_SIMILARITY, 0.56),
  dryRun: String(process.env.MERGE_DRY_RUN ?? "false").toLowerCase() === "true"
};

try {
  console.log("Running duplicate story merge...");
  console.log("Options:", options);
  const result = await mergeSimilarStories(options);
  console.log("Merge complete:");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (error) {
  console.error("Merge failed:", error);
  process.exit(1);
}
