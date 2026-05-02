import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("apps/web/app/page.tsx", "utf8");

assert.ok(
  page.includes("formatSourceCount(featuredStory)") && page.includes("formatSourceCount(story)"),
  "Expected homepage to render source_count via formatSourceCount"
);
assert.equal(
  /\{(?:featuredStory|story)\.article_count\}\s*sources/.test(page),
  false,
  "Homepage must not label article_count as sources"
);
assert.ok(
  page.includes('formatCount(featuredStory.article_count, "article")') &&
    page.includes('formatCount(story.article_count, "article")'),
  "Expected homepage to show article_count separately as articles"
);

console.log("homepage source display checks passed");
