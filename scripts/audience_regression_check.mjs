import assert from "node:assert/strict";
import { storyMatchesAudience } from "../apps/web/src/lib/ranking.ts";

const edtechPositiveCases = [
  {
    title: "California Schools Debate How Much AI Belongs in Classrooms",
    summary: "District leaders are weighing classroom policy and teacher guidance for generative AI tools."
  },
  {
    title: "AllHere Set Meeting With LAUSD Leaders Months Before Landing $6.2M Chatbot Deal",
    summary: "District officials discussed the student-support chatbot before the procurement moved ahead."
  },
  {
    title: "District Rolls Out New Student Data Privacy Rules for AI Tools",
    summary: "School leaders said the education technology policy applies to vendors and classroom software."
  }
];

for (const input of edtechPositiveCases) {
  const text = `${input.title} ${input.summary}`;
  assert.equal(
    storyMatchesAudience(text, "edtech"),
    true,
    `Expected EdTech audience match for "${input.title}"`
  );
}

const edtechNegativeCases = [
  {
    title: "Oklahoma Board Again Rejects Jewish Charter School But Vows to Support it in Court",
    summary: "The Statewide Charter School Board voted again on the application."
  },
  {
    title: "John Liu NYC Class Size Law Mamdani Extension Timeline",
    summary: "Albany leaders continued fighting over the implementation schedule."
  },
  {
    title: "A Record Share of U.S. Workers Now Have Access to Paid Leave",
    summary: "The national labor report tracks workplace benefits trends."
  },
  {
    title: "This Air Conditioning Strategy IS the Sweet Spot for Saving Energy and Money, Experts Say",
    summary: "The report focuses on cooling systems and utility costs."
  },
  {
    title: "Formula 1's Aston Martin Principal Says Team Was Left Blindsided by Lack of Experienced Support",
    summary: "The racing team said it was caught off guard."
  },
  {
    title: "California Colleges Spend Millions on Faulty AI Systems: The Chatbot Is Outdated",
    summary: "California community college districts are spending millions on artificial intelligence chatbots for admissions and campus services."
  }
];

for (const input of edtechNegativeCases) {
  const text = `${input.title} ${input.summary}`;
  assert.equal(
    storyMatchesAudience(text, "edtech"),
    false,
    `Expected EdTech audience rejection for "${input.title}"`
  );
}

assert.equal(
  storyMatchesAudience(
    "Indiana Board Finalizes New A-F School Accountability System State board members approved the framework.",
    "admins"
  ),
  true,
  "Expected admin audience match for accountability story"
);

assert.equal(
  storyMatchesAudience(
    "Teachers Share New Math Instruction Strategy Classroom teams are revising lesson plans.",
    "teachers"
  ),
  true,
  "Expected teacher audience match for classroom instruction story"
);

console.log("audience regression checks passed");
