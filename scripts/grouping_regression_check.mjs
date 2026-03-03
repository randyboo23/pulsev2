import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://localhost/pulse_dummy";
const { evaluateStoryMergeDecision } = await import("../apps/web/src/lib/grouping.ts");

const fixtures = [
  {
    id: "no_merge_cross_state_legal",
    expectMerge: false,
    expectVeto: "state_mismatch",
    left: {
      title: "Frustrated Families Sue the State to Stop Antisemitism in California Schools"
    },
    right: {
      title: "State Superintendent Says Trump’s Michigan Schools Investigations Are Based on False Info"
    }
  },
  {
    id: "no_merge_cross_state_closure",
    expectMerge: false,
    expectVeto: "state_mismatch",
    left: {
      title: "Houston ISD Board Votes to Close 12 Schools, Angering Audience at Meeting"
    },
    right: {
      title: "Memphis Families Seek New School Options After Closure Vote"
    }
  },
  {
    id: "no_merge_entity_conflict",
    expectMerge: false,
    expectVeto: "entity_conflict",
    left: {
      title: "RIVERDALE ALPHA Budget Lawsuit"
    },
    right: {
      title: "LAKEMONT OMEGA Budget Lawsuit"
    }
  },
  {
    id: "merge_same_event_houston_closure",
    expectMerge: true,
    left: {
      title: "Houston ISD Board Votes to Close 12 Schools"
    },
    right: {
      title: "Houston ISD Approves Closure of 12 Schools"
    }
  },
  {
    id: "merge_same_event_wisconsin_funding",
    expectMerge: true,
    left: {
      title: "Wisconsin Parents Sue Legislature Over School Funding Formula"
    },
    right: {
      title: "Lawsuit Challenges Wisconsin School Funding Formula"
    }
  },
  {
    id: "merge_same_event_texas_curriculum",
    expectMerge: true,
    left: {
      title: "Texas Education Board Approves 4,200 Corrections in Bible-Infused Curriculum"
    },
    right: {
      title: "Texas Board Approves 4,200 Changes to Bible-Infused Curriculum"
    }
  }
];

const failures = [];

for (const fixture of fixtures) {
  const result = evaluateStoryMergeDecision(fixture.left, fixture.right);
  const mergeMatches = result.shouldMerge === fixture.expectMerge;
  const vetoMatches =
    fixture.expectVeto === undefined || fixture.expectVeto === result.vetoReason;

  if (!mergeMatches || !vetoMatches) {
    failures.push({
      id: fixture.id,
      expectedMerge: fixture.expectMerge,
      actualMerge: result.shouldMerge,
      expectedVeto: fixture.expectVeto ?? null,
      actualVeto: result.vetoReason,
      details: result.details
    });
    continue;
  }

  console.log(
    `PASS ${fixture.id}: merge=${result.shouldMerge} veto=${result.vetoReason ?? "none"} ratio=${result.details.ratio.toFixed(2)}`
  );
}

if (failures.length > 0) {
  console.error("\nGrouping regression failures:");
  for (const failure of failures) {
    console.error(JSON.stringify(failure, null, 2));
  }
  assert.fail(`Grouping regression failed with ${failures.length} failing fixture(s).`);
}

console.log(`\nGrouping regression passed (${fixtures.length} fixtures).`);
