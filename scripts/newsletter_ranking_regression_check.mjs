import assert from "node:assert/strict";
import { analyzeNewsletterStoryRanking, inferNewsletterLanes } from "../apps/web/src/lib/ranking.ts";

const strongPolicy = analyzeNewsletterStoryRanking({
  title: "State Board Advances School Funding Bill After District Budget Warning",
  summary: "Multiple outlets report the proposal could reshape district budgets and compliance planning.",
  articleCount: 4,
  sourceCount: 4,
  familyCount: 4,
  recentCount: 3,
  avgWeight: 1.15,
  latestAt: new Date(Date.now() - 12 * 60 * 60 * 1000)
});

const thinFeature = analyzeNewsletterStoryRanking({
  title: "Teachers Try New Literacy Routine in One Classroom",
  summary: "A feature looks at one educator's lesson experiment.",
  articleCount: 1,
  sourceCount: 1,
  familyCount: 1,
  recentCount: 1,
  avgWeight: 0.95,
  latestAt: new Date(Date.now() - 6 * 60 * 60 * 1000)
});

assert.ok(
  strongPolicy.score > thinFeature.score,
  `Expected strong policy story to outrank thin feature (${strongPolicy.score} <= ${thinFeature.score})`
);
assert.ok(
  strongPolicy.whyRanked.includes("policy"),
  "Expected policy story to include policy reason"
);
assert.ok(
  strongPolicy.whyRanked.includes("multi_source"),
  "Expected policy story to include multi_source reason"
);

const olderImportantStory = analyzeNewsletterStoryRanking({
  title: "Supreme Court Hears District Funding Case With National Impact",
  summary: "District leaders are watching the case because it could alter funding obligations and state policy.",
  articleCount: 3,
  sourceCount: 3,
  familyCount: 3,
  recentCount: 1,
  avgWeight: 1.2,
  latestAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
});

assert.ok(
  olderImportantStory.score > thinFeature.score,
  `Expected older important story to stay above fresh thin feature (${olderImportantStory.score} <= ${thinFeature.score})`
);

const urgentStory = analyzeNewsletterStoryRanking({
  title: "School Closure Order Issued After Safety Threat",
  summary: "District officials say schools will shift operations immediately after the emergency order.",
  articleCount: 2,
  sourceCount: 2,
  familyCount: 2,
  recentCount: 2,
  avgWeight: 1.05,
  latestAt: new Date(Date.now() - 2 * 60 * 60 * 1000)
});

assert.ok(
  urgentStory.whyRanked.includes("urgent"),
  "Expected emergency story to include urgent reason"
);

const edtechLanes = inferNewsletterLanes({
  title: "District Expands Student Data Privacy Rules for Classroom AI Tools",
  summary: "School leaders approved new guidance for vendors and teacher use of AI software.",
  storyType: "policy",
  whyRanked: ["policy", "district_impact", "edtech"]
});

assert.deepEqual(
  edtechLanes,
  ["policy", "classroom", "leadership", "edtech"],
  `Expected EdTech policy story to map to multiple newsletter lanes (${JSON.stringify(edtechLanes)})`
);

const classroomLanes = inferNewsletterLanes({
  title: "Teachers Use New Literacy Routine to Build Student Fluency",
  summary: "The classroom strategy is spreading through coaching and curriculum teams.",
  storyType: "feature",
  whyRanked: ["classroom_relevance"]
});

assert.deepEqual(
  classroomLanes,
  ["classroom"],
  `Expected classroom feature to stay in classroom lane (${JSON.stringify(classroomLanes)})`
);

console.log("newsletter-ranking regression checks passed");
