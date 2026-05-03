import { pool } from "../apps/web/src/lib/db.ts";

let result;
try {
  result = await pool.query(
    `select created_at, detail
     from admin_events
     where event_type = 'top_story_single_source_audit'
     order by created_at desc
     limit 1`
  );
} catch (error) {
  console.log(
    JSON.stringify(
      {
        found: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exit(0);
}

const row = result.rows[0];
if (!row) {
  console.log(JSON.stringify({ found: false, message: "No top_story_single_source_audit events found" }, null, 2));
  process.exit(0);
}

const detail = row.detail ?? {};
const reasonTotals = {};
for (const story of detail.details ?? []) {
  for (const [reason, count] of Object.entries(story.reasons ?? {})) {
    reasonTotals[reason] = (reasonTotals[reason] ?? 0) + Number(count ?? 0);
  }
}

console.log(
  JSON.stringify(
    {
      found: true,
      created_at: row.created_at,
      checked: detail.checked ?? 0,
      single_source_stories: detail.singleSourceStories ?? 0,
      discovered_candidates: detail.discoveredCandidates ?? 0,
      linked: detail.linked ?? 0,
      reason_totals: reasonTotals,
      stories: (detail.details ?? []).map((story) => ({
        rank: story.rank,
        title: story.title,
        checked_candidates: story.checkedCandidates,
        linked: story.linked,
        skipped_reason: story.skippedReason,
        reasons: story.reasons,
        candidate_samples: story.candidateSamples ?? []
      }))
    },
    null,
    2
  )
);
