import assert from "node:assert/strict";
import {
  countSourceFamilies,
  sourceFamilyFromArticle,
  sourceFamilyFromDomain
} from "../apps/web/src/lib/source-family.ts";

const familyCases = [
  ["www.edweek.org", "educationweek.org"],
  ["educationweek.org", "educationweek.org"],
  ["www.nytimes.com", "nytimes.com"],
  ["subdomain.reuters.com", "reuters.com"],
  ["schools.chalkbeat.org", "chalkbeat.org"],
  ["www.bbc.co.uk", "bbc.co.uk"]
];

for (const [domain, expected] of familyCases) {
  assert.equal(
    sourceFamilyFromDomain(domain),
    expected,
    `Unexpected family normalization for ${domain}`
  );
}

const familyCount = countSourceFamilies([
  "www.edweek.org",
  "educationweek.org",
  "chalkbeat.org",
  "www.chalkbeat.org",
  "districtadministration.com"
]);

assert.equal(familyCount, 3, "Expected deduped family count to be 3");

assert.equal(
  sourceFamilyFromArticle({
    domain: "localpaper.com",
    summary: "This story was reported by The Associated Press."
  }),
  "apnews.com",
  "Expected Associated Press syndicated copy to share AP family"
);

assert.equal(
  sourceFamilyFromArticle({
    domain: "example.com",
    sourceName: "Reuters"
  }),
  "reuters.com",
  "Expected Reuters syndicated copy to share Reuters family"
);

console.log("source-family regression checks passed");
