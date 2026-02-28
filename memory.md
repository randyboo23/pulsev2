# Pulse Memory

Purpose:
- Shared decision memory so we do not re-litigate product choices.
- Keep this short and current.
- Record decisions and constraints, not long explanations.

Last updated: 2026-02-28

---

## Product Direction
- Build a Techmeme-style homepage for US K-12 education news.
- Prioritize signal over volume.
- AI is used as judge/filter first, generator second.
- Human/editorial overrides remain available.

## Current Summary Policy
- Summary candidates pipeline: rss -> cache check -> free scrape -> Firecrawl -> llm -> fallback -> adjudication.
- Top story summary refresh now uses Firecrawl-first for the highest-priority stories each run, then free scrape fallback.
- Firecrawl usage is hard-capped daily (`FIRECRAWL_DAILY_BUDGET`, default 90) with event-based tracking in `admin_events`.
- Scrape-type feed parsing now uses free HTML link extraction first; Firecrawl feed parsing is fallback only.
- Firecrawl enters temporary backoff on 402/429 so ingest continues on free methods instead of repeated hard failures.
- Free scrape (`freeArticleScrape()`) uses plain HTTP fetch + regex extraction (no API cost).
- Preview contract: `preview_type` (full/excerpt/headline_only/synthetic), `preview_confidence` (0..1).
- Fallback/synthetic text stored for debugging but not shown to users.
- Headline-only is preferred over generic filler blurbs.
- Legacy synthetic phrasing suppressed (`coverage is converging on ...`, generic `why it matters` tails).
- AI summary budget: 50 AI calls per cycle.
- Firecrawl scrape budget: 30 per ingest, 20 per fill (3,000 credits/month plan, resets Feb 16).
- Tier-based scrape priority: A=skip (RSS good), B=free scrape if RSS<50 chars, C/unknown=free then Firecrawl.
- LLM summary prompt: "state key fact first", max 60 words, returns "IRRELEVANT" for off-topic content.
- AI adjudication now fires for single-candidate stories when quality is mediocre (bestScore < 0.7).

## Current Ranking Policy
- Deterministic ranking feeds into AI reranking pass (Sonnet).
- Deterministic ranking now applies title-topic similarity penalties and a final diversity pass to reduce same-event repetition in top slots.
- Topic diversity now uses alias-aware tokens (`LAUSD` -> `Los Angeles Unified...`) and broader generic-word stopwords so same-event variants are suppressed more reliably in top slots.
- Ingest now runs a similar-story merge pass after lexical grouping to collapse near-duplicate clusters into one story with combined sources.
- `story_type` emitted as `breaking | policy | feature | evergreen | opinion`.
- Lead eligibility is explicit (`lead_eligible`, `lead_reason`).
- Penalty values (tuned 2026-02-06):
  - `singletonPenalty`: 0.75
  - `thinCoveragePenalty`: 0.82
  - `hardNewsPenalty`: tiered 0.45 (unknown) / 0.6 (authority >= 1.0)
  - `evergreenPenalty`: 0.35
- Evergreen classification requires `impact === 0 && novelty === 0`.
- Relevance weight: 1.3x.
- AI reranker (Sonnet) reorders top 30 stories; cached 15 minutes.
- Unknown source default weight: 0.7.

## AI Relevance Gate
- Discovery feed articles and unknown-tier sources checked by Claude Haiku.
- Budget: 100 relevance checks per ingest cycle.
- Score < 0.3: rejected. Score 0.3-0.5: uncertain (admin review). Score > 0.5: accepted.
- Stored in `relevance_score`, `relevance_category`, `relevance_reason` columns.

## Personal Blog Filtering
- Deterministic: `classifyArticleQuality()` detects first-person language ("I teach", "my classroom"), how-to framing, student club posts, community engagement meta-posts. 2+ hits = -0.35 penalty, 1 hit = -0.15.
- AI prompt: relevance gate explicitly calls out first-person teacher narratives, how-to listicles, "I teach/my students" signal as NOT RELEVANT.

## Source Policy
- 20+ curated RSS/scrape feeds.
- 6 Google News discovery queries with exclusions for personal blogs.
- Tier A national outlets: AP, Reuters, NYT, WaPo, Politico, NPR, PBS.
- Edutopia: lowest source tier (mostly teacher blogs, not news, garbled headlines).
- Unknown source default weight lowered to 0.7.

## Headline Formatting
- `normalizeTitleCase()` now applies title casing when less than 40% of words start uppercase.
- Properly title-cased headlines are left as-is.

## Story Detail Page
- Single-source stories: coverage section shows source name, headline, date, link only (no repeated summary).
- Multi-source stories: coverage section shows per-article summaries.

## Pipeline Notes
- Ingest runs on schedule through GitHub Actions.
- Manual `/admin/stories` backfill is recovery-only, not daily workflow.
- One-time duplicate-story cleanup is available via `scripts/run-merge-stories.mjs` (dry run supported).
- Runtime path remains in `apps/web`; `apps/worker` is deferred.
- `extractJson()` helper strips markdown fences and preamble from Claude API responses before JSON parsing.

## Working Agreements
- Claude handles all implementation: backend, frontend, data pipeline, and design.
- Backend passes clear rendering signals to UI (`preview_type`, `preview_confidence`).

## Near-Term Priorities
1. Stabilize current ranking and summary quality improvements.
2. Implement embedding-based story clustering (see docs/embedding-clustering-spec.md).
3. Add fixture-based regression tests for ranking and quality gates.
4. Build newsletter subscription feature.

## Decisions Log
- 2026-02-06: Added free HTML scrape layer before Firecrawl to reduce API costs.
- 2026-02-06: Reduced Firecrawl budgets from 80/60 back to 30/20 due to hitting 100% credit usage.
- 2026-02-06: Added DB cache check for scraping to avoid redundant Firecrawl calls.
- 2026-02-06: Implemented tier-based scrape priority (A=skip, B=conditional, C=free+fallback).
- 2026-02-06: Added personal blog detection (first-person language, how-to patterns).
- 2026-02-06: Expanded AI adjudication trigger to fire on single-candidate mediocre quality.
- 2026-02-06: Fixed story detail page to not repeat summary for single-source stories.
- 2026-02-06: Fixed headline normalization to apply title case to lowercase headlines.
- 2026-02-06: Deprioritized Edutopia to lowest source tier.
- 2026-02-11: Enabled RLS on all tables with permissive policies (server-side auth only, no browser client).
- 2026-02-28: Added topic-similarity scoring penalties and final top-story diversity filtering to suppress same-event duplicate stories on homepage.
- 2026-02-28: Added Firecrawl 402/429 backoff and free-HTML-first scrape-feed parsing to avoid ingest failures when Firecrawl credits are exhausted.
- 2026-02-28: Replaced `rss-parser` `parseURL()` usage with HTTP fetch + `parseString()` to remove Node `url.parse()` deprecation warnings in ingest.
- 2026-02-28: Added quality-priority Firecrawl routing for top summary candidates with hard daily throttling (`firecrawl_usage` events).
- 2026-02-28: Added post-grouping similar-story merge in ingest plus a one-time merge backfill script; ran live backfill iterations and merged 71 duplicate stories total.
