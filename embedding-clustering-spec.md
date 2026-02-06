# Next Major Feature: Embedding-Based Story Clustering

## Problem
All stories currently show 1 source because grouping uses title-key matching (lexical). Articles about the same topic with different headlines get treated as separate stories. This is the single biggest product gap -- it's the difference between "list of articles" and "actual news aggregator."

Example of what's broken:
- "Philadelphia school closures proposed" → Story A (1 source)
- "Philly district plans to close 20 schools" → Story B (1 source)
- "Philadelphia teachers protest closures" → Story C (1 source)
These should all be 1 story with 3 sources.

## Solution: Embedding-Based Clustering

### Phase 1: Embed Articles
- On ingest, after an article passes quality gates, embed its title + first 200 chars of summary using OpenAI's text-embedding-3-small (cheapest, fast, good enough for clustering)
- Store the embedding vector in a new column on the articles table
- Use pgvector extension for Postgres (add to schema.sql)
- Only embed new articles, skip if embedding already exists

### Phase 2: Cluster on Ingest
- When a new article is embedded, compare its vector against all articles from the last 72 hours using cosine similarity
- If similarity > 0.85 with an existing article that belongs to a story, add the new article to that story
- If similarity > 0.85 with another ungrouped article, create a new story grouping both
- If no match above threshold, create a new single-article story (same as current behavior)
- Time window matters: don't cluster a February article with a December article on the same topic even if semantically similar

### Phase 3: Update Story Metadata on Cluster
- When a story gains a new source, update:
  - source_count on the story
  - Regenerate story summary to synthesize across sources (use AI summarization)
  - Pick the best/most authoritative headline from the cluster as story title
  - Update last_seen_at

### Phase 4: Boost Ranking by Source Count
- In ranking.ts, add source_count as a ranking signal
- Stories with 3+ sources should get a significant boost
- This naturally solves the "teacher blog outranks NYT" problem since blogs will almost always be single-source

## Implementation Notes
- pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector;`
- New column: `ALTER TABLE articles ADD COLUMN embedding vector(1536);` (1536 dims for text-embedding-3-small)
- Cosine similarity in Postgres: `1 - (embedding <=> query_embedding)` 
- Create an index: `CREATE INDEX ON articles USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`
- OpenAI embedding API cost: ~$0.02 per 1M tokens, negligible for our volume
- Set OPENAI_API_KEY in .env (or reuse existing if we have one)

## Constraints
- Don't break existing ingest flow. Embedding + clustering should be an additional step after current quality gates.
- Graceful fallback: if embedding API fails, fall back to current title-key grouping
- Keep Anthropic API budget in mind for summary regeneration on cluster updates
- Similarity threshold (0.85) should be configurable in config or .env so we can tune it easily

## What to Update After Implementation
- schema.sql (pgvector extension, embedding column, index)
- ingest.ts (embed step, cluster step)
- ranking.ts (source_count boost)
- stories.ts (summary regeneration on cluster update)
- ARCHITECTURE.md (new data flow)
- memory.md (decisions made)
- README.md (new env var for OPENAI_API_KEY, pgvector requirement)

## Do NOT do yet
- Don't implement this until current ranking/summary improvements are committed and stable
- This is the NEXT major feature, not an immediate task
- Save this file for reference when we're ready to build it
