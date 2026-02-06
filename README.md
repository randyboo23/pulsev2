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
- Facts-first story summaries are preferred over generic impact templates during story summary assembly.
- Homepage preview dedupe suppresses near-duplicate blurb text across top stories.
- Story previews are confidence-gated via `preview_type` and `preview_confidence`; fallback/synthetic output is stored for debugging but displayed as headline-only.
- Automatic story-brief refresh on ingest (`fillStorySummaries`) so top stories update continuously.
- Story grouping by title key.
- Deterministic ranking analysis with `story_type` (`breaking|policy|feature|evergreen|opinion`) and lead-eligibility gating.
- Lead-story selection guardrail: evergreen/opinion items are demoted from hero unless urgency override signals are present.
- Source authority is now weighted more aggressively in ranking, with additional demotion for single-source low-authority stories.
- Hard-news gate now demotes low-newsworthiness feature clusters (single-source, low-urgency, non-policy) so instructional evergreen content does not float to top slots.
- Hard-news signal now prioritizes urgency/policy evidence over generic terms, reducing false promotion of instructional feature content.
- Ranking transparency in QA output (lead reason + score breakdown) for fast tuning.
- Latest Wire now filters generic section/meta links and short non-headline titles more aggressively.
- Additional fallback-template suppression is applied for legacy synthetic phrasing (including "coverage is converging on ...").
- Admin controls for feeds, sources, and story status.

## Current Gaps (Why Quality Regressions Happen)
- Story grouping is still lexical and can miscluster profile/about content.
- AI adjudication is in place for story summary candidates, but not yet for headline/body extraction candidates.
- Quality gating is still mostly deterministic for article eligibility and grouping.
- Ranking is still deterministic (no AI top-N reranker yet); no embedding-based relevance/novelty layer yet.
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
- `memory.md`: shared product and implementation decision memory for Codex + Claude.

## Manual Ingest
1. Set `DATABASE_URL` and `INGEST_SECRET` in `.env`.
2. Optional for AI adjudication/generation: set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`).
3. Optional for scrape candidate summaries: set `FIRECRAWL_API_KEY`.
4. Optional for scheduled GET calls: set `CRON_SECRET`.
5. Run SQL from `db/schema.sql`.
6. POST to `/api/ingest` with header `x-ingest-secret`.

## Automation (Recommended)
- Use a scheduler to hit `/api/ingest` every 30 minutes.
- Set `CRON_SECRET` in your deployment env vars.
- Scheduler request format: `GET /api/ingest` with `Authorization: Bearer <CRON_SECRET>`.
- Vercel Hobby supports daily cron only; use an external scheduler for 30-minute cadence.
- `cron-job.org` currently has a 30-second timeout and is not suitable for this ingest duration.
- Recommended for Hobby: GitHub Actions scheduler (`.github/workflows/ingest-cron.yml`) with secrets:
  - `INGEST_URL` = `https://<your-domain>/api/ingest`
  - `CRON_SECRET` = same bearer secret used by `/api/ingest`
- `/api/ingest` also accepts manual `POST` with `x-ingest-secret` for debugging.
- `/admin/stories` -> `Backfill story briefs (manual)` is a recovery tool, not the daily workflow.

Note: `db/schema.sql` is idempotent; re-run it after schema updates.

## Local QA Loop (No Commit Needed)
- Run from repo root: `/Users/andydue/Desktop/pulsev2`
- Terminal 1: `npm run dev:web`
- Terminal 2: `npm run qa:summaries`
- What it does:
  - triggers `POST /api/ingest` against `http://localhost:3000` (or `QA_BASE_URL` if set),
  - prints ingest JSON stats,
  - prints a summary-quality report (blank preview count, near-duplicate count, lead eligibility diagnostics, and top preview list).
- If you see `Failed to connect to localhost port 3000`, start/restart `npm run dev:web` first.
- Optional knobs:
  - `QA_BASE_URL` (default `http://localhost:3000`)
  - `QA_STORY_LIMIT` (default `20`)
  - `QA_SHOW_LIMIT` (default `10`)

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
