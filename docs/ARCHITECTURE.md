# Architecture

## Runtime Topology
- Single runtime today: `apps/web` (Next.js app + API routes + ingest logic).
- Persistent store: Postgres (Supabase).
- Optional external services:
  - Anthropic: summary adjudication, ingest-time AI reranking, relevance gating, and bounded LLM rewrite.
  - Firecrawl: full-text extraction when free scrape and RSS summaries are weak.
- Scheduler: GitHub Actions (`.github/workflows/ingest-cron.yml`) calls `GET /api/ingest`.

## Data Flow
```
RSS Feeds + Google News Discovery
    |
    v
ingest.ts -- fetch feeds, normalize URLs, resolve redirects
    |          scrape feeds: free HTML link extraction first, Firecrawl fallback
    |          discovery feed item cap limits per-query Google News volume
    |          Firecrawl 402/429 -> temporary backoff (ingest continues without it)
    |
    v
Quality Gate (ingest.ts) -- classify: article / uncertain / non_article
    |                         personal blog detection (first-person language, how-to, listicles)
    |                         AI relevance gate (Claude Haiku) for discovery/unknown sources + AP education scrape feed
    |                         deterministic K-12 topical fallback for AP feed when relevance score is missing
    |                         hard off-topic rejects for sports, higher-ed-only, event listings,
    |                         international conflict, and non-actionable crime without school-system angle
    |
    v
Free HTML Scrape (freeArticleScrape) -- try fetch + readability first (free)
    |                                    fall back to Firecrawl only if needed
    |                                    DB cache check to skip re-scraping known articles
    |                                    tier-based priority: A=skip, B=free if RSS<50 chars, C=free then Firecrawl
    |
    v
Summary Adjudication -- compare candidates (existing / rss / scrape / llm / fallback)
    |                    top-priority stories: Firecrawl-first within daily cap
    |                    all others: free scrape first, Firecrawl fallback
    |                    AI adjudication if available, deterministic fallback
    |
    v
Grouping (grouping.ts) -- lexical title-key matching + similar-story merge pass
    |                      merge pass uses event-aware token normalization + overlap and runs multi-pass per ingest
    |                      legal-ruling phrasing is canonicalized into a shared action token for same-case court coverage
    |                      merge vetoes block cross-state and entity-conflict merges
    |                      post-merge split pass detaches clear mixed-cluster outlier articles
    |                      PLANNED: embedding-based clustering (see docs/embedding-clustering-spec.md)
    |
    v
Ranking (ranking.ts + stories.ts) -- deterministic scoring (impact, urgency, policy, novelty,
    |                                relevance, source authority, recency, volume)
    |                                penalties: evergreen, singleton, thin coverage, hard news gate,
    |                                plus alias-aware title-topic similarity penalty for same-event repeats
    |                                source diversity uses independent source-family count (not just raw outlet count)
    |                                candidate-quality gate removes static/taxonomy story titles before scoring
    |                                manual status overrides: pinned prioritized, hidden excluded, demoted deferred
    |                                final top-20 event-cluster cap keeps one story per event unless novelty signal is strong
    |
    v
Top-Story Publish Gate (ingest.ts) -- audits candidate top slots before persisted ranking
    |                                  runs a merge-first prepass on the AI-ranked top candidate set
    |                                  evaluates the same AI-ranked candidate pool used for homepage persistence
    |                                  flags mixed-state/entity-conflict clusters using merge-veto heuristics
    |                                  enforces state/state+topic saturation caps in the top window
    |                                  applies stale-slot and thin-roundup demotions for low-momentum top stories
    |                                  re-runs in small iterative passes so replacement stories are also checked
    |                                  auto-demotes flagged non-pinned stories and logs `ingest_top_story_gate` each ingest run
    |                                  final top-10 duplicate audit emits `ingest_guardrail_alert` when same-event pairs remain
    |                                  optional SMTP email notification can fire for duplicate-pair alerts (cooldown + dedupe)
    |                                  optional SMTP LinkedIn-draft email can fire when top-ranked stories hit source-count threshold
    |
    v
AI Reranking (ingest.ts -> stories.ts) -- Sonnet reorders top stories by editorial judgment
    |                                  order persisted to `stories.homepage_rank` each ingest run
    |                                  graceful fallback to deterministic if Anthropic unavailable
    |
    v
Homepage (page.tsx) -- getTopStories() reads precomputed rank from DB (fallback compute if rank missing)
                       Latest Wire sidebar via getRecentArticles()

Newsletter Menu (api/newsletter/menu/route.ts) -- getNewsletterMenuStories() ranks a 7-day story slice
                                                with gentler weekly recency, source-family weighting,
                                                homepage diversity guards, a strict K-12 topical gate,
                                                and primary/supporting article links
                                                snapshot logged to `admin_events` for later editor feedback
```

## Request Flows
- Automated ingest:
  - Scheduler calls `GET /api/ingest` with Bearer token.
  - Route validates `CRON_SECRET` or `INGEST_SECRET`.
  - `ingestFeeds()` returns JSON stats.
- Manual ingest/debug:
  - `POST /api/ingest` with `x-ingest-secret`.
- Manual summary recovery:
  - Admin trigger calls `fillStorySummaries()` for top stories only.
- Weekly newsletter menu:
  - Editor/Cowork calls `GET /api/newsletter/menu` with `Authorization: Bearer <NEWSLETTER_SECRET>` or `x-newsletter-secret`.
  - Route returns ranked weekly story menu JSON and logs the generated menu snapshot to `admin_events`.

## Pages

| Route | Status | Notes |
|-------|--------|-------|
| `/` | Complete | Homepage with masthead, nav, newsletter bar, featured story, story grid, wire sidebar |
| `/stories/[id]` | Complete | Story detail with sources list (deduped for single-source stories) |
| `/admin/stories` | Functional | Uses legacy classes, works fine |
| `/admin/sources` | Functional | Uses legacy classes |
| `/about` | Complete | Editorial about page |
| `/newsletter` | External | Nav/footer link to Beehiiv newsletter (pulsek12.com) |

## Pending Features

### Category Filtering (Future)
- **Location**: Nav bar links (Policy, Classroom, EdTech, Leadership)
- **Currently**: All link to `/` (placeholder)
- **When ready**: Change to `/category/[slug]` or `/?category=[slug]`
- **Tasks**: Add category field, update getTopStories(), LLM classification

### Embedding-Based Story Clustering (Next Major Feature)
- See `docs/embedding-clustering-spec.md` for full spec.
- Replaces lexical title-key grouping with semantic similarity.
- Enables multi-source story grouping and source count as ranking signal.

## File Reference

```
apps/web/
  app/
    globals.css              # All styles
    layout.tsx               # Root layout with footer
    page.tsx                 # Homepage
    stories/[id]/page.tsx    # Story detail page
    admin/                   # Admin pages
    about/page.tsx           # About page
    error.tsx                # Error boundary
    not-found.tsx            # Custom 404
    loading.tsx              # Loading state
    robots.ts                # robots.txt
    sitemap.ts               # Dynamic sitemap
    opengraph-image.tsx      # Auto-generated OG image
    api/
      ingest/route.ts        # Ingest endpoint (GET + POST)
      newsletter/menu/route.ts       # Weekly newsletter menu endpoint
      newsletter/subscribe/route.ts  # Beehiiv subscribe proxy
      admin/generate-summaries/route.ts
      admin/cleanup-international/route.ts
      admin/login/route.ts
  src/lib/
    ingest.ts                # Ingestion pipeline + free scrape + Firecrawl
    articles.ts              # Article queries + quality classification
    ranking.ts               # Deterministic scoring logic
    stories.ts               # Story queries + ranking logic + homepage-rank persistence
    grouping.ts              # Story clustering (currently lexical)
    feeds.ts                 # Feed registry + discovery queries
    sources.ts               # Source tiers (moved to packages/core)
    admin.ts                 # Admin logic
    db.ts                    # Database connection
  src/components/
    NewsletterForm.tsx       # Client-side Beehiiv subscribe form
  src/styles/                # Additional styles
  src/types/                 # Local type definitions

packages/core/
  src/
    types.ts                 # Shared type definitions (update first for new data)
    sources.ts               # Source tiers and trusted sites

db/
  schema.sql                 # Postgres schema (idempotent)

scripts/
  newsletter_ranking_regression_check.mjs # Newsletter ranking fixture regression check
  k12_relevance_regression_check.mjs      # K-12 topical filter regression check
  qa-summaries.sh            # QA runner
  run-merge-stories.mjs      # One-time duplicate-story backfill merge (supports dry run)
  summary_quality_report.mjs # QA report logic
```

## Data Model (Primary Tables)
- `sources`: domain, tier, weight.
- `feeds`: source link, type (`rss` or `scrape`), health fields.
- `articles`: canonical URL, content fields, quality fields, summary-choice diagnostics, relevance scoring.
- `stories`: cluster-level headline/summary + preview contract + status + precomputed homepage order (`homepage_rank`, `homepage_ranked_at`).
- `story_articles`: many-to-many article linkage and primary flag.
- `admin_events`: admin action trail.

## Read/Render Contracts
- Homepage uses `getTopStories()`: ranked stories ordered by precomputed `homepage_rank` when available, with filtered preview text and lead metadata.
- Newsletter menu uses `getNewsletterMenuStories()`: ranked 7-day story menu with `menu_id`, weekly score, `why_ranked`, and primary/supporting article links for downstream editorial workflows.
- Latest Wire uses `getRecentArticles()`: stricter link/title hygiene plus AP-wire topical filtering.
- Story detail page reads `stories` + linked `articles`. Single-source stories show source link without repeating summary.
- Preview contract: `preview_type` (full/excerpt/headline_only/synthetic), `preview_confidence` (0..1).
- Fallback/synthetic text stored for debugging but not shown to users.

## Notes
- Newsletter subscribe uses Beehiiv API via server-side proxy (`/api/newsletter/subscribe`). Requires `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID` env vars.
- Newsletter menu requires `NEWSLETTER_SECRET`; generated menus are logged in `admin_events` under `newsletter_menu_generated` for later feedback attachment.
- SEO: root metadata with OG/Twitter tags, per-story `generateMetadata()`, dynamic sitemap, robots.txt, auto-generated OG image.
- All styling uses CSS classes from `globals.css`.
- Admin pages use "legacy" class names -- they work, low priority to update.

## Known Limits
- Grouping starts lexical (`story_key`) and then does a token-overlap merge pass with state/entity vetoes plus mixed-cluster outlier splits; semantic edge cases still remain until embedding clustering lands.
- Worker orchestration (`apps/worker`) is not yet the runtime execution path.
- No comprehensive fixture-based regression suite yet for summary/ranking (grouping has a focused fixture regression check).
- Newsletter feedback capture UI is not built yet; only the weekly menu snapshot persistence is in place.
