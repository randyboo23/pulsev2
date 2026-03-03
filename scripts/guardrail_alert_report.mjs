import pg from "pg";

const { Client } = pg;

const LIMIT = Number.parseInt(process.env.GUARDRAIL_ALERT_LIMIT ?? "20", 10) || 20;

function toArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add it to .env before running qa:guardrails.");
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(
      `select created_at, detail
       from admin_events
       where event_type = 'ingest_guardrail_alert'
       order by created_at desc
       limit $1`,
      [Math.max(1, LIMIT)]
    );

    const rows = result.rows;
    if (rows.length === 0) {
      console.log("No ingest_guardrail_alert events found.");
      return;
    }

    const alertCounts = new Map();
    let totalOutliers = 0;
    let totalSplits = 0;
    let totalMergedStories = 0;

    for (const row of rows) {
      const detail = row.detail ?? {};
      const alerts = toArray(detail.guardrailAlerts);
      for (const alert of alerts) {
        const key = String(alert);
        alertCounts.set(key, (alertCounts.get(key) ?? 0) + 1);
      }
      totalOutliers += toNumber(detail.mixedStoryOutliers);
      totalSplits += toNumber(detail.mixedStoriesSplit);
      totalMergedStories += toNumber(detail.mergedStories);
    }

    console.log(`Guardrail alerts found: ${rows.length}`);
    console.log(
      `Aggregate metrics (last ${rows.length} alerts): mergedStories=${totalMergedStories}, mixedOutliers=${totalOutliers}, mixedSplits=${totalSplits}`
    );

    if (alertCounts.size > 0) {
      console.log("Alert frequency:");
      for (const [alert, count] of [...alertCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`- ${alert}: ${count}`);
      }
    }

    console.log("\nLatest events:");
    rows.forEach((row, index) => {
      const detail = row.detail ?? {};
      const alerts = toArray(detail.guardrailAlerts).map((value) => String(value));
      console.log(
        `${index + 1}. ${formatTime(row.created_at)} | alerts=${alerts.join(", ") || "none"} | grouped=${toNumber(detail.grouped)} merged=${toNumber(detail.mergedStories)} outliers=${toNumber(detail.mixedStoryOutliers)} splits=${toNumber(detail.mixedStoriesSplit)}`
      );
    });
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
