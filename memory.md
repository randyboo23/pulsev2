# Pulse Memory

Purpose:
- Shared decision memory so we do not re-litigate product choices.
- Keep this short and current.
- Record decisions and constraints, not long explanations.

Last updated:
- 2026-02-06

## Product Direction
- Build a Techmeme-style homepage for US K-12 education news.
- Prioritize signal over volume.
- AI is used as judge/filter first, generator second.
- Human/editorial overrides remain available.

## Current Summary Policy
- Homepage preview contract uses:
- `preview_type`: `full` | `excerpt` | `headline_only` | `synthetic`
- `preview_confidence`: `0..1`
- Fallback/synthetic text is stored for debugging but not shown to users.
- If preview confidence is low, render headline-only.
- Headline-only is preferred over generic filler blurbs.
- Legacy synthetic phrasing classes (`coverage is converging on ...`, generic `why it matters` tails) are explicitly suppressed.
- AI summary budget: 50 calls per ingest cycle (up from 20).
- Firecrawl scrape budget: 80 per ingest cycle (up from 40).
- LLM summary prompt instructs "state key fact first" and max 60 words (up from 45).
- LLM returns "IRRELEVANT" for off-topic content, which is discarded.

## Current Ranking Policy
- Deterministic ranking feeds into an AI reranking pass (Sonnet).
- `story_type` is emitted as `breaking | policy | feature | evergreen | opinion`.
- Lead eligibility is explicit (`lead_eligible`, `lead_reason`).
- Penalty values (tuned 2026-02-06):
  - `singletonPenalty`: 0.75 (was 0.62)
  - `thinCoveragePenalty`: 0.82 (was 0.72)
  - `hardNewsPenalty`: 0.45 (unknown sources) / 0.6 (authority >= 1.0) (was flat 0.24)
  - `evergreenPenalty`: 0.35 (unchanged)
- Evergreen classification now requires `impact === 0 && novelty === 0` in addition to instructional hints.
- Relevance weight boosted to 1.3x (was 1.0x).
- AI reranker (Sonnet) reorders top 30 stories by editorial judgment; cached 15 minutes.
- Unknown source default weight lowered to 0.7 (was 0.9).

## AI Relevance Gate
- Discovery feed articles and unknown-tier sources are checked by Claude Haiku.
- Budget: 100 relevance checks per ingest cycle.
- Score < 0.3: article rejected.
- Score 0.3-0.5: marked `uncertain`, still inserted for admin review.
- Score > 0.5: proceeds normally.
- Stored in `relevance_score`, `relevance_category`, `relevance_reason` columns.

## Source Policy
- 20 curated RSS/scrape feeds (added EdWeek, NPR Education, PBS NewsHour, AP News).
- 6 Google News discovery queries with exclusions for personal blogs.
- TRUSTED_SITES expanded with national outlets (AP, NPR, PBS, Reuters, NYT, WaPo, Politico).
- Tier A national outlets added: apnews.com, reuters.com, nytimes.com, washingtonpost.com, politico.com, npr.org, pbs.org.

## Pipeline Notes
- Ingest runs on schedule through GitHub Actions.
- Manual `/admin/stories` backfill is recovery-only, not daily workflow.
- Runtime path remains in `apps/web`; `apps/worker` is deferred.

## Working Agreements
- Claude handles all implementation: backend, frontend, data pipeline, and design.
- Backend should pass clear rendering signals to UI (`preview_type`, `preview_confidence`).

## Near-Term Priorities
- Run ingest and validate AI relevance gate behavior on live data.
- Tune relevance threshold if false positives/negatives appear.
- Improve clustering beyond lexical `story_key` when ranking quality stabilizes.
- Add fixture-based regression tests for ranking and quality gates.
