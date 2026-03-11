import assert from "node:assert/strict";
import {
  hasK12TopicSignal,
  hasStrictK12TopicSignal,
  isClearlyOffTopicForK12
} from "../apps/web/src/lib/k12-relevance.ts";

const positiveCases = [
  {
    title: "Indiana Board Finalizes New A-F School Accountability System",
    summary: "The state board approved a new accountability framework for public schools."
  },
  {
    title: "Bill Would Create Sales Tax Holiday for School Supplies",
    summary: "Lawmakers say the measure would lower costs for families during the school year."
  },
  {
    title: "California Schools Debate How Much AI Belongs in Classrooms",
    summary: "District leaders are weighing classroom policy and instructional use cases."
  }
];

for (const input of positiveCases) {
  assert.equal(
    hasK12TopicSignal(input),
    true,
    `Expected broad K-12 signal for "${input.title}"`
  );
  assert.equal(
    hasStrictK12TopicSignal(input),
    true,
    `Expected strict K-12 signal for "${input.title}"`
  );
}

const strictRejectCases = [
  {
    title: "Bills Are Getting Receiver D.J. Moore in a Trade with the Bears, AP Sources Say",
    summary: "The Buffalo Bills acquired a top target for quarterback Josh Allen.",
    offTopic: true
  },
  {
    title: "Formula 1's Aston Martin Principal Says Team Was Left Blindsided by Lack of Experienced Support",
    summary: "The F1 team principal said the staff situation caught the team off guard.",
    offTopic: true
  },
  {
    title: "Evidence Suggests the Deadly Blast at an Iranian School Was Likely a US Airstrike",
    summary: "Investigators believe the deadly blast was caused by a military strike.",
    offTopic: true
  },
  {
    title: "US House Appropriations Committee considers needs of community colleges, including Pell Grant funds",
    summary: "The committee reviewed higher-ed funding priorities and degree completion.",
    offTopic: true
  },
  {
    title: "How Colleges Are Reconnecting with Students Who Left Before Earning Degrees",
    summary: "Institutions are working to help former college students finish their credentials.",
    offTopic: true
  },
  {
    title: "Cal State sues U.S. Department of Education over transgender athlete at San José State",
    summary: "The university system sued the federal agency over enforcement tied to a college athletics dispute.",
    offTopic: true
  },
  {
    title: "Sustainability & Education Virtual Information Session | Teachers College, Columbia University",
    summary: "Join us for a virtual information session hosted by Teachers College.",
    offTopic: true
  },
  {
    title: "Authorities Say a Georgia Teacher Was Killed in a Prank Gone Wrong",
    summary: "Authorities say a teacher was killed after teenagers pulled a late-night prank.",
    offTopic: true
  },
  {
    title: "Man Accused of Tricking Hundreds of Teens into Sending Him Pornographic Images Is Brought to US",
    summary: "A man accused of child sexual exploitation was extradited to the United States.",
    offTopic: true
  }
];

for (const input of strictRejectCases) {
  assert.equal(
    hasStrictK12TopicSignal(input),
    false,
    `Expected strict K-12 rejection for "${input.title}"`
  );
  assert.equal(
    isClearlyOffTopicForK12(input),
    input.offTopic,
    `Unexpected off-topic classification for "${input.title}"`
  );
}

console.log("k12 relevance regression checks passed");
