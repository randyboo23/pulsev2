# Pulse K-12 v2

Shared homepage for US education news.

## Current Scope
- Curated tiered sources + RSS ingestion (Google News RSS queries).
- Lightweight story grouping (no embeddings).
- Education-specific ranking rubric.
- Clean homepage + story pages.

## Structure
- `apps/web`: Next.js frontend and ingest endpoint.
- `packages/core`: shared types and source lists.
- `db/schema.sql`: minimal Postgres schema.

## Manual Ingest
1. Set `DATABASE_URL` and `INGEST_SECRET` in `.env`.
2. Run the SQL in `db/schema.sql`.
3. POST to `/api/ingest` with header `x-ingest-secret`.

Note: `db/schema.sql` is idempotent; re-run it after schema updates.

## Cleanup
- `db/cleanup_international.sql` removes likely non-US articles and orphaned stories.

## Next (Deferred)
- Trigger.dev orchestration.
- Firecrawl or other full-text extraction.
- Vector embeddings and clustering algorithms.
- Local trend engine.
