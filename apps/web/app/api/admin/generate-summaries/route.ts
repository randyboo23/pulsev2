import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/admin";
import { pool } from "@/src/lib/db";
import { getTopStories } from "@/src/lib/stories";
import { fillStorySummaries } from "@/src/lib/ingest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireAdmin();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const topStories = await getTopStories(20);
  const ids = topStories.map((story) => story.id);

  const summaryResult = await fillStorySummaries(40, ids, true, 20);

  try {
    await pool.query(
      "insert into admin_events (event_type, detail) values ($1, $2)",
      [
        "generate_summaries",
        {
          source: "admin_button",
          enriched: Number(summaryResult.enriched),
          adjudicated_ai: Number(summaryResult.adjudicatedAI),
          adjudicated_deterministic: Number(summaryResult.adjudicatedDeterministic),
          llm_generated: Number(summaryResult.llmGenerated),
          rejected: Number(summaryResult.rejected)
        }
      ]
    );
  } catch {
    // admin_events table might not exist yet; ignore.
  }

  return NextResponse.redirect(new URL("/admin/stories", request.url));
}

export async function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}
