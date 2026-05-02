import assert from "node:assert/strict";
import { analyzeStoryRanking } from "../apps/web/src/lib/ranking.ts";

const now = Date.now();

const corroboratedPolicy = analyzeStoryRanking({
  title: "State Board Advances School Funding Bill After District Budget Warning",
  summary: "Three independent outlets report the proposal could reshape district budgets and compliance planning.",
  articleCount: 4,
  sourceCount: 4,
  familyCount: 4,
  recentCount: 3,
  avgWeight: 1.15,
  latestAt: new Date(now - 8 * 60 * 60 * 1000)
});

const thinSingleSourceFeature = analyzeStoryRanking({
  title: "Teachers Try New Literacy Routine in One Classroom",
  summary: "A feature looks at one educator's lesson experiment.",
  articleCount: 1,
  sourceCount: 1,
  familyCount: 1,
  recentCount: 1,
  avgWeight: 1.0,
  latestAt: new Date(now - 2 * 60 * 60 * 1000)
});

assert.ok(
  corroboratedPolicy.score > thinSingleSourceFeature.score,
  `Expected corroborated policy story to outrank thin singleton (${corroboratedPolicy.score} <= ${thinSingleSourceFeature.score})`
);
assert.ok(
  thinSingleSourceFeature.breakdown.singleSourcePenalty < 1,
  "Expected ordinary single-source feature to receive single-source penalty"
);

const urgentAuthoritySingleton = analyzeStoryRanking({
  title: "Emergency School Closure Ordered After Safety Threat",
  summary: "District officials said schools will close immediately while security teams respond to the urgent threat.",
  articleCount: 1,
  sourceCount: 1,
  familyCount: 1,
  recentCount: 2,
  avgWeight: 1.2,
  latestAt: new Date(now - 90 * 60 * 1000)
});

assert.equal(
  urgentAuthoritySingleton.breakdown.singleSourcePenalty,
  1,
  "Expected urgent high-authority breaking singleton to avoid the ordinary single-source penalty"
);
assert.equal(
  urgentAuthoritySingleton.urgencyOverride,
  true,
  "Expected urgent singleton to use urgency override"
);

console.log("ranking regression checks passed");
