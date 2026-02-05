# Architecture (MVP)

## Current Scope
- Curated tiered sources + RSS ingestion (Google News RSS queries).
- Lightweight story grouping (no embeddings).
- Education-specific ranking rubric.
- Clean homepage + story pages.

## Manual Ingest
- POST `/api/ingest` with `x-ingest-secret` header.
- Requires `INGEST_SECRET` in the environment.

## Ranking Rubric (V1)
- Impact: policy, funding, governance, district-wide changes.
- Urgency: safety, closures, threats, outbreaks, emergency response.
- Novelty: pilots, launches, first-time initiatives.
- Relevance: teachers, students, classrooms, K-12 references.
- Source weight: higher weight for trusted and Tier A sources.
- Recency: decay over 48 hours.

## Story Grouping (V1)
- Normalize titles, drop stopwords, sort tokens to create `story_key`.
- Attach new articles to existing `story_key` within 7 days.
- No embeddings; simple and fast.

## Next (Deferred)
- Trigger.dev orchestration.
- Firecrawl or other full-text extraction.
- Vector embeddings and clustering algorithms.
- Local trend engine.
