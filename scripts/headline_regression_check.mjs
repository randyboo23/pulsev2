import assert from "node:assert/strict";
import { normalizeHeadlineTitle } from "../apps/web/src/lib/headline.ts";

const cases = [
  [
    "dpscd will not renew charter for barack obama leadership academy",
    "DPSCD Will Not Renew Charter for Barack Obama Leadership Academy"
  ],
  [
    "district expands student data privacy rules for classroom ai tools",
    "District Expands Student Data Privacy Rules for Classroom AI Tools"
  ],
  [
    "Illinois bill to ban school cell phone use moves forward",
    "Illinois Bill to Ban School Cell Phone Use Moves Forward"
  ],
  [
    "One School, Nine Students. CA Pays Over $100,000 Per Kid to Keep Small Schools Open",
    "One School, Nine Students. CA Pays Over $100,000 Per Kid to Keep Small Schools Open"
  ],
  [
    "mcmahon: fy 27 proposal continues to shrink bloated bureaucracy",
    "McMahon: FY 27 Proposal Continues to Shrink Bloated Bureaucracy"
  ],
  [
    "Teacher Salaries Average $74.5K Nationally. IS IT Enough?",
    "Teacher Salaries Average $74.5K Nationally. Is It Enough?"
  ],
  [
    "‘Star Trek’ Didn’t Replace Teachers or Ban Screens; nor Should WE",
    "‘Star Trek’ Didn’t Replace Teachers or Ban Screens; nor Should We"
  ],
  [
    "North Carolina Ranks 43RD for Teacher Pay in 2024-25",
    "North Carolina Ranks 43rd for Teacher Pay in 2024-25"
  ],
  [
    "TX district expands K-12 AI policy",
    "TX District Expands K-12 AI Policy"
  ]
];

for (const [input, expected] of cases) {
  assert.equal(
    normalizeHeadlineTitle(input),
    expected,
    `Unexpected headline normalization for "${input}"`
  );
}

console.log("headline regression checks passed");
