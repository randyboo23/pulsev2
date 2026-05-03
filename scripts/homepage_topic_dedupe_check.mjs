import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://localhost/pulse_dummy";

const { calculateHomepageTopicOverlapForTest } = await import("../apps/web/src/lib/stories.ts");

const raleighFunding = calculateHomepageTopicOverlapForTest(
  "Teachers March in Raleigh for Higher Pay, School Funding",
  "Triangle Educators Rally in Raleigh for More School Funding"
);

assert.ok(
  raleighFunding.ratio >= 0.4,
  `Expected same-event Raleigh funding titles to hit topic overlap guard (${raleighFunding.ratio})`
);
assert.ok(
  raleighFunding.sharedActionTokens >= 1,
  "Expected same-event Raleigh funding titles to share an action token"
);
assert.ok(
  raleighFunding.sharedStrongTokens >= 1,
  "Expected same-event Raleigh funding titles to share a non-generic location token"
);

console.log("homepage topic dedupe checks passed");
