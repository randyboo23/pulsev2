import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://localhost/pulse_dummy";

const { evaluateStoryMergeDecision } = await import("../apps/web/src/lib/grouping.ts");
const {
  buildCorroborationSearchQuery,
  isAggregatorDomain,
  isWithinCoverageWindow,
  titleLedeSimilarity
} = await import("../apps/web/src/lib/source-coverage.ts");
const { sourceFamilyFromArticle } = await import("../apps/web/src/lib/source-family.ts");

assert.equal(isAggregatorDomain("news.yahoo.com"), true, "Expected Yahoo News to be rejected as aggregator");
assert.equal(isAggregatorDomain("www.msn.com"), true, "Expected MSN to be rejected as aggregator");
assert.equal(isAggregatorDomain("apple.news"), true, "Expected Apple News to be rejected as aggregator");
assert.equal(isAggregatorDomain("chalkbeat.org"), false, "Expected original publisher to be allowed");

assert.equal(
  sourceFamilyFromArticle({
    domain: "local.example",
    summary: "The Associated Press contributed to this report."
  }),
  "apnews.com",
  "Expected AP syndicated copy to dedupe to AP family"
);
assert.equal(
  sourceFamilyFromArticle({
    domain: "local.example",
    summary: "Reporting by Reuters."
  }),
  "reuters.com",
  "Expected Reuters syndicated copy to dedupe to Reuters family"
);

const seedTime = new Date("2026-05-01T12:00:00Z");
assert.equal(
  isWithinCoverageWindow(seedTime, new Date("2026-05-03T11:00:00Z"), 72),
  true,
  "Expected same-event article inside 72h window"
);
assert.equal(
  isWithinCoverageWindow(seedTime, new Date("2026-05-05T13:00:00Z"), 72),
  false,
  "Expected stale same-topic article outside 72h window to be rejected"
);

const crossState = evaluateStoryMergeDecision(
  { title: "Florida District Approves School Cell Phone Ban" },
  { title: "Texas District Approves School Cell Phone Ban" }
);
assert.equal(crossState.vetoReason, "state_mismatch", "Expected cross-state same-keyword result to be vetoed");

const sameEventSimilarity = titleLedeSimilarity({
  seedTitle: "Illinois Bill to Ban School Cell Phone Use Moves Forward",
  seedSummary: "Lawmakers advanced a school cell phone restriction bill for public schools.",
  candidateTitle: "Illinois School Cellphone Ban Advances in Legislature",
  candidateSummary: "The proposal would restrict student phone use across Illinois public schools."
});
assert.ok(sameEventSimilarity >= 0.28, `Expected related title/lede to pass similarity (${sameEventSimilarity})`);

const unrelatedSimilarity = titleLedeSimilarity({
  seedTitle: "Illinois Bill to Ban School Cell Phone Use Moves Forward",
  seedSummary: "Lawmakers advanced a school cell phone restriction bill for public schools.",
  candidateTitle: "Texas District Names New Superintendent After Search",
  candidateSummary: "The board voted to hire a new leader after a national superintendent search."
});
assert.ok(unrelatedSimilarity < 0.28, `Expected unrelated result to fail similarity (${unrelatedSimilarity})`);

assert.equal(
  buildCorroborationSearchQuery("Illinois Bill to Ban School Cell Phone Use Moves Forward"),
  "illinois bill ban cell phone use move forward",
  "Expected stable search query tokenization"
);

console.log("source-coverage regression checks passed");
