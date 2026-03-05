import assert from "node:assert/strict";
import { isLikelyNonStoryTitle, isLikelyNonStoryUrl } from "../apps/web/src/lib/story-quality.ts";

const rejectTitles = [
  "Privacy Policy",
  "Privacy Policy, Updated August 2024",
  "Work with Us",
  "9-12 High School",
  "6-8 Middle School",
  "Terms of Use",
  "Contact Us",
  "North America",
  "Politics & Policy",
  "State of the Union"
];

const allowTitles = [
  "Supreme Court Sides with California Parents in Gender Identity Case",
  "Summer Ebt Sun Bucks Program",
  "Families Turn to States for Civil Rights Support as Trump Dismantles the Education Department",
  "District and Union Leaders Call for Funding Boost as School Closures Loom"
];

const rejectUrls = [
  "https://www.chalkbeat.org/pages/privacy-policy/",
  "https://www.rand.org/services-and-impact/work-with-us.html",
  "https://www.edutopia.org/grade-level-9-12",
  "https://example.com/terms-of-use",
  "https://www.brookings.edu/tags/state-of-the-union-2026/"
];

const allowUrls = [
  "https://www.chalkbeat.org/tennessee/2026/03/04/summer-ebt-sun-bucks-program/",
  "https://www.edweek.org/policy-politics/families-turn-to-states-for-civil-rights-support/2026/03"
];

for (const title of rejectTitles) {
  assert.equal(
    isLikelyNonStoryTitle(title),
    true,
    `Expected non-story title rejection for: "${title}"`
  );
}

for (const title of allowTitles) {
  assert.equal(
    isLikelyNonStoryTitle(title),
    false,
    `Unexpected non-story title rejection for: "${title}"`
  );
}

for (const url of rejectUrls) {
  assert.equal(
    isLikelyNonStoryUrl(url),
    true,
    `Expected non-story URL rejection for: "${url}"`
  );
}

for (const url of allowUrls) {
  assert.equal(
    isLikelyNonStoryUrl(url),
    false,
    `Unexpected non-story URL rejection for: "${url}"`
  );
}

console.log("story-quality regression checks passed");
