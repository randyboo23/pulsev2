# Pulse K-12 v2

Techmeme for US K-12 education news.

## Vision
- Build the daily high-signal homepage for education leaders.
- Reduce thousands of noisy inputs into a small set of stories worth attention.
- Surface what matters first: policy moves, district impact, classroom implications, and urgent developments.
- Combine AI judgment with human editorial control, not AI alone.

## Product Principles
- Signal over volume: ranking is based on importance, not just recency.
- Cluster-first UX: users follow story clusters, not isolated links.
- Explainable ranking: each top story should have visible reasons for ranking.
- AI as judge, not unchecked generator: AI can score and classify quality, but output must pass quality gates.
- Human-in-the-loop: editors can pin, hide, merge, retitle, and override summaries.
- Fast iteration, ruthless trimming: ship quickly, then keep only what proves useful.

## North-Star Experience
- A homepage that answers: "What are the 5-10 most important K-12 stories right now?"
- Each story card includes:
  - clean headline
  - trustworthy brief summary
  - source count and update tempo
  - link-out coverage
- A daily/weekly briefing loop that brings users back (site + newsletter cadence).

## Current Scope (Today)
- Curated source registry with tier/weight controls.
- RSS + scrape ingestion with canonical URL normalization.
- Deterministic ingest quality gate with per-article quality labels (`article` / `uncertain` / `non_article`).
- Summary adjudication layer that compares candidate summaries (`existing` / `scrape` / `llm`) and stores winner + confidence + reason codes.
- Story brief guardrails: anti-headline-echo checks, deterministic fallback briefs, and section-index URL filtering.
- Weak RSS summaries can be upgraded via bounded scrape enrichment (when `FIRECRAWL_API_KEY` is set), across feed types.
- Synthetic fallback phrasing is suppressed in homepage display selection to reduce repetitive previews.
- Automatic story-brief refresh on ingest (`fillStorySummaries`) so top stories update continuously.
- Story grouping by title key.
- Basic education-specific ranking rubric.
- Admin controls for feeds, sources, and story status.

## Current Gaps (Why Quality Regressions Happen)
- Story grouping is still lexical and can miscluster profile/about content.
- AI adjudication is in place for story summary candidates, but not yet for headline/body extraction candidates.
- Quality gating is still mostly deterministic for article eligibility and grouping.
- Ranking is keyword-driven; no embedding-based relevance or novelty layer yet.
- Worker/orchestration path is mostly stubbed (`apps/worker`) while logic lives in web server code.
- No reliable automated regression suite for ingestion and story quality.

## Back-on-Track Plan
1. Add AI adjudication for enrichment:
   - compare RSS/metadata/scrape/LLM candidates.
   - choose a winner per field with confidence + reason codes.
2. Upgrade clustering and ranking:
   - move from title-key clustering to embedding + recency hybrid.
   - add editorial "gravity" scoring dimensions (impact, urgency, novelty, audience fit, credibility).
3. Separate durable orchestration:
   - move ingest/enrich/cluster/score jobs into worker orchestration with retries and observability.
4. Add QA and guardrails:
   - fixture-based tests for bad-content classes (profiles, bios, sponsorship fluff, markdown artifacts).
   - dashboard metrics for null/low-quality summary rates and false-positive story rate.

## Structure
- `apps/web`: Next.js frontend, admin, and current ingest runtime.
- `apps/worker`: planned durable job orchestration pipeline.
- `packages/core`: shared types and source lists.
- `db/schema.sql`: Postgres schema.

## Manual Ingest
1. Set `DATABASE_URL` and `INGEST_SECRET` in `.env`.
2. Optional for AI adjudication/generation: set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`).
3. Optional for scrape candidate summaries: set `FIRECRAWL_API_KEY`.
4. Optional for scheduled GET calls: set `CRON_SECRET`.
5. Run SQL from `db/schema.sql`.
6. POST to `/api/ingest` with header `x-ingest-secret`.

## Automation (Recommended)
- Use a scheduler to hit `/api/ingest` every 30 minutes.
- `vercel.json` includes a cron entry for this path.
- For Vercel:
  - set `CRON_SECRET` in project env vars.
  - Vercel sends `Authorization: Bearer <CRON_SECRET>` to `/api/ingest`.
- `/api/ingest` also accepts manual `POST` with `x-ingest-secret` for debugging.
- `/admin/stories` -> `Backfill story briefs (manual)` is a recovery tool, not the daily workflow.

Note: `db/schema.sql` is idempotent; re-run it after schema updates.

## Autonomous Runtime (Expected Daily Operation)
- Normal mode is fully automated:
  - scheduler calls `/api/ingest` every 30 minutes.
  - ingest fetches feeds, filters low-quality/non-article links, groups stories, and refreshes story briefs.
  - homepage reflects newest grouped stories and briefs without manual admin clicks.
- Manual `Backfill story briefs (manual)` is for recovery:
  - after schema/prompt changes,
  - after fixing bad historical data,
  - when you intentionally want a one-time reprocess.

## Summary Quality Modes
- Best quality path:
  - `ANTHROPIC_API_KEY` set and valid.
  - optional `FIRECRAWL_API_KEY` set for stronger scrape candidates.
  - AI adjudication + optional LLM rewrite chooses better, more distinct briefs.
- Fallback path (still functional, lower quality):
  - if Anthropic is unavailable (for example `404 across candidate models`), pipeline falls back to deterministic templates.
  - this can make multiple briefs sound similar even when titles differ.
- If briefs become repetitive, check:
  - Anthropic model/key validity.
  - whether logs show repeated Anthropic `404`/auth failures.
  - whether source URLs are unresolved aggregator links (these are now skipped where possible).

## Admin
- `/admin/stories`: status, merge, cleanup, and brief generation.
- `/admin/feeds`: feed health and toggles.
- `/admin/sources`: source weights and tiers.
