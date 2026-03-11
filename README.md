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
- Static/taxonomy candidate guardrail: non-story titles/URLs (e.g. policy/privacy/work-with-us/grade-level index pages) are filtered from ranking and classified as `non_article` during ingest quality scans.
- Summary adjudication layer that compares candidate summaries (`existing` / `scrape` / `llm`) and stores winner + confidence + reason codes.
- Story brief guardrails: anti-headline-echo checks, deterministic fallback briefs, and section-index URL filtering.
- Weak RSS summaries can be upgraded via bounded scrape enrichment (when `FIRECRAWL_API_KEY` is set), across feed types.
- Synthetic fallback phrasing is suppressed in homepage display selection to reduce repetitive previews.
- Facts-first story summaries are preferred over generic impact templates during story summary assembly.
- Homepage preview dedupe suppresses near-duplicate blurb text across top stories.
- Story previews are confidence-gated via `preview_type` and `preview_confidence`; fallback/synthetic output is stored for debugging but displayed as headline-only.
- Automatic story-brief refresh on ingest (`fillStorySummaries`) so top stories update continuously.
- Top-story publish gate runs before rank persistence to auto-demote suspect top slots (mixed-state/entity-conflict clusters and state/topic saturation spillover).
- Top-story publish gate now runs a merge-first prepass on the AI-ranked top candidate pool so same-event duplicates are merged before any top-slot demotion fallback.
- Ingest now audits persisted top-10 stories for same-event duplicate pairs and emits a guardrail alert when any remain after merge/publish-gate passes.
- Optional: duplicate-pair guardrail alerts can send email via SMTP (Gmail supported) when top-story duplicates remain.
- Automatic homepage-rank refresh on ingest (`refreshHomepageRanks`) so homepage order is precomputed in DB.
- Story grouping by title key, plus automatic similar-story merge pass during ingest.
- Story-merge guardrails now hard-veto cross-state/entity-conflict merges and run a post-merge outlier split pass for mixed clusters.
- Ingest telemetry now reports mixed-cluster audit counters (`mixedStoryCandidates`, `mixedStoryOutliers`, `mixedStoriesSplit`).
- Deterministic ranking analysis with `story_type` (`breaking|policy|feature|evergreen|opinion`) and lead-eligibility gating.
- Top-story ranking now applies title-topic diversity suppression, semantic event-action normalization, and a top-20 event-cluster cap (with strict novelty override) to reduce same-event repeats.
- Ranking now also uses source-family-aware diversity (independent publisher families) so syndicated/alias duplicates carry less weight than genuinely independent corroboration.
- Lead-story selection guardrail: evergreen/opinion items are demoted from hero unless urgency override signals are present.
- Source authority is now weighted more aggressively in ranking, with additional demotion for single-source low-authority stories.
- Hard-news gate now demotes low-newsworthiness feature clusters (single-source, low-urgency, non-policy) so instructional evergreen content does not float to top slots.
- Hard-news signal now prioritizes urgency/policy evidence over generic terms, reducing false promotion of instructional feature content.
- Ranking transparency in QA output (lead reason + score breakdown) for fast tuning.
- Latest Wire now filters generic section/meta links and short non-headline titles more aggressively.
- AP News Education wire items now run a K-12 topical guard (ingest + render-time fallback) to suppress off-topic AP posts.
- Additional fallback-template suppression is applied for legacy synthetic phrasing (including "coverage is converging on ...").
- Admin controls for feeds, sources, and story status.

## Remaining Gaps
- Story grouping is still lexical (`story_key`) and can miscluster edge cases. Embedding-based clustering is the planned replacement.
- Worker/orchestration path is mostly stubbed (`apps/worker`) while logic lives in web server code.
- No comprehensive fixture-based regression suite yet for ingestion and ranking quality (grouping now has a focused fixture check).

## Structure
- `apps/web`: Next.js frontend, admin, and current ingest runtime.
- `apps/worker`: planned durable job orchestration pipeline.
- `packages/core`: shared types and source lists.
- `db/schema.sql`: Postgres schema.
- `memory.md`: shared product and implementation decision memory.

## Manual Ingest
1. Set `DATABASE_URL` and `INGEST_SECRET` in `.env`.
2. Optional for AI adjudication/generation: set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`).
3. Optional for scrape candidate summaries: set `FIRECRAWL_API_KEY`.
4. Optional Firecrawl controls: `FIRECRAWL_DAILY_BUDGET` (default `90`), `FIRECRAWL_PRIORITY_STORY_LIMIT` (default `12`).
5. Optional for scheduled GET calls: set `CRON_SECRET`.
6. Optional for newsletter subscribe: set `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID`.
7. Optional for weekly newsletter menu: set `NEWSLETTER_SECRET`.
8. Run SQL from `db/schema.sql`.
9. POST to `/api/ingest` with header `x-ingest-secret`.

## Weekly Newsletter Menu
- Endpoint: `GET /api/newsletter/menu`
- Auth: `Authorization: Bearer <NEWSLETTER_SECRET>` or `x-newsletter-secret: <NEWSLETTER_SECRET>`
- Query params:
  - `limit` (default `30`, bounded `10..50`)
  - `days` (default `7`, bounded `3..14`)
- Response includes:
  - `menu_id`
  - `ranking_version`
  - ranked stories with `why_ranked`, weekly score, source counts, and primary/supporting article links
- Intended workflow:
  - Cowork/editor fetches the weekly menu
  - shortlists stories for the issue
  - uses returned links and summaries to draft Beehiiv-ready blurbs
- Each generated menu is also logged to `admin_events` as `newsletter_menu_generated` so future feedback can attach to the exact menu snapshot that was shown.

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
- Optional extra check: `npm run qa:grouping` (fixture-based merge regression guardrail)
- Optional extra check: `npm run qa:newsletter-ranking` (fixture-based weekly newsletter ranking guardrail)
- Optional extra check: `npm run qa:story-quality` (fixture-based non-story candidate filter guardrail)
- Optional extra check: `npm run qa:source-family` (fixture-based source-family dedupe guardrail)
- Optional monitoring check: `npm run qa:guardrails` (shows recent ingest guardrail alerts from `admin_events`)
- What it does:
  - triggers `POST /api/ingest` against `http://localhost:3000` (or `QA_BASE_URL` if set),
  - prints ingest JSON stats,
  - prints a summary-quality report (blank preview count, near-duplicate count, lead eligibility diagnostics, and top preview list).
- If you see `Failed to connect to localhost port 3000`, start/restart `npm run dev:web` first.
- Optional knobs:
  - `QA_BASE_URL` (default `http://localhost:3000`)
  - `QA_STORY_LIMIT` (default `20`)
  - `QA_SHOW_LIMIT` (default `10`)

## Grouping Guardrails
- Ingest emits grouping anomaly alerts into `admin_events` (`event_type = ingest_guardrail_alert`) when merge/split metrics cross thresholds.
- Ingest also logs top-slot publish gate runs to `admin_events` (`event_type = ingest_top_story_gate`) every cycle.
- Optional threshold env vars:
  - `INGEST_ALERT_MERGED_STORIES` (default `25`)
  - `INGEST_ALERT_MERGE_TO_GROUPED_RATIO` (default `0.65`)
  - `INGEST_ALERT_MIXED_OUTLIERS` (default `1`)
  - `INGEST_ALERT_SPLIT_STORIES` (default `1`)
  - `INGEST_ALERT_TOP_STORY_DUPLICATE_PAIRS` (default `1`)
  - `TOP_STORY_PUBLISH_GATE_LIMIT` (default `10`)
  - `TOP_STORY_PUBLISH_GATE_SCAN_LIMIT` (default `20`)
  - `TOP_STORY_PUBLISH_GATE_MAX_PASSES` (default `3`)
  - `TOP_STORY_PUBLISH_GATE_STATE_MISMATCH_MIN` (default `2`)
  - `TOP_STORY_PUBLISH_GATE_ENTITY_CONFLICT_MIN` (default `2`)
  - `TOP_STORY_PUBLISH_GATE_STATE_LIMIT` (default `1`)
  - `TOP_STORY_PUBLISH_GATE_STATE_OVERRIDE_SOURCE_COUNT` (default `3`; allows additional same-state top stories when source count meets threshold)
  - `TOP_STORY_PUBLISH_GATE_STATE_TOPIC_LIMIT` (default `1`)
  - `TOP_STORY_PUBLISH_GATE_STALE_TOP3_HOURS` (default `48`)
  - `TOP_STORY_PUBLISH_GATE_STALE_TOP10_HOURS` (default `72`)
  - `TOP_STORY_PREMERGE_ENABLED` (default `true`)
  - `TOP_STORY_PREMERGE_CANDIDATE_LIMIT` (default `20`)
  - `TOP_STORY_PREMERGE_MAX_MERGES` (default `4`)
  - `TOP_STORY_PREMERGE_LOOKBACK_DAYS` (default `10`)
  - `TOP_STORY_PREMERGE_SIMILARITY` (default `0.54`)
  - `TOP_STORY_DUPLICATE_AUDIT_LIMIT` (default `10`)
  - `TOP_STORY_DUPLICATE_AUDIT_SIMILARITY` (default `0.54`)
  - `INGEST_MAX_DISCOVERY_ITEMS_PER_FEED` (default `40`; caps Google News discovery volume per query to control noise/cost)
  - `GUARDRAIL_ALERT_EMAIL_COOLDOWN_MINUTES` (default `60`, skips repeated same-pair alerts within cooldown)
  - `GUARDRAIL_ALERT_EMAIL_SMTP_HOST` (default `smtp.gmail.com`)
  - `GUARDRAIL_ALERT_EMAIL_SMTP_PORT` (default `465`)
  - `GUARDRAIL_ALERT_EMAIL_SMTP_USER` (required to send email)
  - `GUARDRAIL_ALERT_EMAIL_SMTP_PASS` (required to send email; use Gmail App Password)
  - `GUARDRAIL_ALERT_EMAIL_FROM` (default SMTP user)
  - `GUARDRAIL_ALERT_EMAIL_TO` (comma-separated recipients; required to send email)
  - `GUARDRAIL_ALERT_EMAIL_EHLO` (default `pulsek12.com`)
  - `LINKEDIN_TOP_STORY_EMAIL_ENABLED` (default `true`; set `false` to disable LinkedIn draft emails)
  - `LINKEDIN_TOP_STORY_EMAIL_MIN_SOURCES` (default `3`)
  - `LINKEDIN_TOP_STORY_EMAIL_RANK_LIMIT` (default `10`; scans top-ranked stories up to this slot)
  - `LINKEDIN_TOP_STORY_EMAIL_MAX_SOURCE_NAMES` (default `3`; source names listed in generated post)

## One-Time Story Backfill Merge
- Run from repo root to merge existing duplicate story clusters:
  - `node --conditions react-server --import tsx/esm scripts/run-merge-stories.mjs`
- Optional env controls:
  - `MERGE_DRY_RUN=true` (preview only, no writes)
  - `MERGE_LOOKBACK_DAYS` (default `45`)
  - `MERGE_CANDIDATE_LIMIT` (default `500`)
  - `MERGE_MAX` (default `250`)
  - `MERGE_SIMILARITY` (default `0.56`)

## Autonomous Runtime (Expected Daily Operation)
- Normal mode is fully automated:
  - scheduler calls `/api/ingest` every 30 minutes.
  - ingest fetches feeds, filters low-quality/non-article links, groups stories, refreshes story briefs, and persists homepage rank order.
  - homepage reflects newest grouped stories and briefs without manual admin clicks.
- Manual `Backfill story briefs (manual)` is for recovery:
  - after schema/prompt changes,
  - after fixing bad historical data,
  - when you intentionally want a one-time reprocess.

## Summary Quality Modes
- Best quality path:
  - `ANTHROPIC_API_KEY` set and valid.
  - optional `FIRECRAWL_API_KEY` set for stronger scrape candidates.
  - Firecrawl is prioritized for top summary candidates each run (bounded by daily budget).
  - AI adjudication + optional LLM rewrite chooses better, more distinct briefs.
- Fallback path (still functional, lower quality):
  - if Anthropic is unavailable (for example `404 across candidate models`), pipeline falls back to deterministic templates.
  - this can make multiple briefs sound similar even when titles differ.
  - if Firecrawl returns `402/429`, ingest applies temporary backoff and continues with free HTML extraction paths.
- If briefs become repetitive, check:
  - Anthropic model/key validity.
  - whether logs show repeated Anthropic `404`/auth failures.
  - whether source URLs are unresolved aggregator links (these are now skipped where possible).

## Admin
- `/admin/stories`: status, merge, cleanup, and brief generation.
  - Homepage context rows are labeled for `Top #1-#10` and `Next #11-#20`.
  - Stories are grouped into `Top 10 Homepage Stories`, `Next 10 Watchlist`, and collapsible `All other stories` for faster editorial triage.
  - Guardrails section shows recent `top_story_duplicate_pairs` alerts with one-click merge/demote actions per flagged pair.
  - Guardrails section now includes last-24h health counters (gate runs, premerge merged/suggested, duplicate pairs/alerts, demotions, duplicate emails sent).
  - Guardrails section also includes `Send test guardrail email` and displays latest test send status.
  - Guardrails section includes `Send top-story LinkedIn draft` to manually email a copy/paste LinkedIn post for the highest-source story in the current top-story window.
  - Admin submit buttons now show inline `Working...` then `Done` confirmations so editors can confirm actions fired without leaving the page.
  - Use status `pinned` to force priority and `demoted` to push a story out of top homepage slots without hiding it.
- `/admin/feeds`: feed health and toggles.
- `/admin/sources`: source weights and tiers.
