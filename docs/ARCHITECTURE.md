# Architecture

## Runtime Topology
- Single runtime today: `apps/web` (Next.js app + API routes + ingest logic).
- Persistent store: Postgres (Supabase).
- Optional external services:
  - Anthropic: summary adjudication, AI reranking, relevance gating, and bounded LLM rewrite.
  - Firecrawl: full-text extraction when free scrape and RSS summaries are weak.
- Scheduler: GitHub Actions (`.github/workflows/ingest-cron.yml`) calls `GET /api/ingest`.

## Data Flow
```
RSS Feeds + Google News Discovery
    |
    v
ingest.ts -- fetch feeds, normalize URLs, resolve redirects
    |          scrape feeds: free HTML link extraction first, Firecrawl fallback
    |          Firecrawl 402/429 -> temporary backoff (ingest continues without it)
    |
    v
Quality Gate (ingest.ts) -- classify: article / uncertain / non_article
    |                         personal blog detection (first-person language, how-to, listicles)
    |                         AI relevance gate (Claude Haiku) for discovery/unknown sources
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
    |                      merge pass uses normalized token overlap to collapse near-duplicate stories
    |                      PLANNED: embedding-based clustering (see docs/embedding-clustering-spec.md)
    |
    v
Ranking (ranking.ts + stories.ts) -- deterministic scoring (impact, urgency, policy, novelty,
    |                                relevance, source authority, recency, volume)
    |                                penalties: evergreen, singleton, thin coverage, hard news gate,
    |                                plus alias-aware title-topic similarity penalty for same-event repeats
    |
    v
AI Reranking (stories.ts) -- Sonnet reorders top 30 by editorial judgment
    |                         15-minute cache, graceful fallback to deterministic
    |                         final topic-diversity filter before homepage render
    |
    v
Homepage (page.tsx) -- getTopStories() serves ranked stories with preview contract
                       Latest Wire sidebar via getRecentArticles()
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
      newsletter/subscribe/route.ts  # Beehiiv subscribe proxy
      admin/generate-summaries/route.ts
      admin/cleanup-international/route.ts
      admin/login/route.ts
  src/lib/
    ingest.ts                # Ingestion pipeline + free scrape + Firecrawl
    articles.ts              # Article queries + quality classification
    ranking.ts               # Deterministic scoring logic
    stories.ts               # Story queries + AI reranking + summary fill
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
  qa-summaries.sh            # QA runner
  run-merge-stories.mjs      # One-time duplicate-story backfill merge (supports dry run)
  summary_quality_report.mjs # QA report logic
```

## Data Model (Primary Tables)
- `sources`: domain, tier, weight.
- `feeds`: source link, type (`rss` or `scrape`), health fields.
- `articles`: canonical URL, content fields, quality fields, summary-choice diagnostics, relevance scoring.
- `stories`: cluster-level headline/summary + preview contract + status.
- `story_articles`: many-to-many article linkage and primary flag.
- `admin_events`: admin action trail.

## Read/Render Contracts
- Homepage uses `getTopStories()`: ranked stories with filtered preview text and lead metadata.
- Latest Wire uses `getRecentArticles()`: stricter link/title hygiene.
- Story detail page reads `stories` + linked `articles`. Single-source stories show source link without repeating summary.
- Preview contract: `preview_type` (full/excerpt/headline_only/synthetic), `preview_confidence` (0..1).
- Fallback/synthetic text stored for debugging but not shown to users.

## Notes
- Newsletter subscribe uses Beehiiv API via server-side proxy (`/api/newsletter/subscribe`). Requires `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID` env vars.
- SEO: root metadata with OG/Twitter tags, per-story `generateMetadata()`, dynamic sitemap, robots.txt, auto-generated OG image.
- All styling uses CSS classes from `globals.css`.
- Admin pages use "legacy" class names -- they work, low priority to update.

## Known Limits
- Grouping starts lexical (`story_key`) and then does a token-overlap merge pass; semantic edge cases still remain until embedding clustering lands.
- Worker orchestration (`apps/worker`) is not yet the runtime execution path.
- No fixture-based regression suite yet for clustering/summary/ranking.
