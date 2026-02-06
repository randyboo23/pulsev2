# Pulse K-12 — Project Reference

This document provides implementation context and design system reference for the project.

## Ownership

Claude handles all implementation: backend, frontend, data pipeline, and design.

- Database schema and migrations (`db/`)
- API endpoints (`apps/web/app/api/`)
- Data ingestion, enrichment, clustering (`apps/web/src/lib/`)
- Business logic (ranking, grouping, articles, stories)
- Authentication and admin logic
- External service integrations (RSS, Firecrawl, Anthropic)
- Type definitions (`packages/core/src/types.ts`)
- Visual design, layout, and styling of `.tsx` pages
- Global styles and theme direction (`apps/web/app/globals.css`)
- Responsive design, UI states, form UX

### Shared Contract
- `packages/core/src/types.ts` — all data shapes referenced across codebase
- Update types first when adding new data requirements

---

## Design System: "The Broadsheet"

Editorial newspaper aesthetic with:
- **Fonts**: Playfair Display (headlines), Source Serif 4 (body), IBM Plex Sans (UI)
- **Colors**: Cream paper background (`#faf8f5`), ink text (`#1a1a18`), crimson accent (`#b8232f`)
- **Layout**: 12-column grid, 8-col main + 4-col sidebar

---

## Pages

| Route | Status | Notes |
|-------|--------|-------|
| `/` | Complete | Homepage with masthead, nav, newsletter bar, featured story, story grid, wire sidebar |
| `/stories/[id]` | Complete | Story detail with sources list |
| `/admin/stories` | Functional | Uses legacy classes, works fine |
| `/admin/sources` | Functional | Uses legacy classes |
| `/newsletter` | **Needs page** | Nav link exists, page doesn't |

---

## Pending Features

### Newsletter Subscription
**Location**: Above-fold bar + footer form
**Forms POST to**: `/api/newsletter/subscribe`
**Expected payload**: `{ email: string }`
**Expected response**: `{ success: boolean; message?: string }`
**Tasks**:
- Create `subscribers` table (email, created_at, confirmed, etc.)
- Create `/api/newsletter/subscribe` endpoint
- Integrate with email service (Resend, Buttondown, etc.)
- Optional: double opt-in flow

### Category Filtering (Future)
**Location**: Nav bar links (Policy, Classroom, EdTech, Leadership)
**Currently**: All link to `/` (placeholder)
**When ready**: Change to `/category/[slug]` or `/?category=[slug]`
**Tasks**:
- Add `category` field to stories or articles
- Update `getTopStories()` to accept category filter
- Categorization logic (LLM classification)

---

## File Reference

```
apps/web/
├── app/
│   ├── globals.css          # All styles
│   ├── layout.tsx           # Root layout with footer
│   ├── page.tsx             # Homepage
│   ├── stories/[id]/page.tsx
│   ├── admin/               # Admin pages
│   └── api/                 # API routes
├── src/lib/
│   ├── stories.ts           # Story queries + ranking
│   ├── articles.ts          # Article queries
│   ├── ranking.ts           # Scoring logic
│   ├── ingest.ts            # Ingestion pipeline
│   ├── grouping.ts          # Story clustering
│   ├── feeds.ts             # Feed registry
│   └── db.ts                # Database connection
packages/core/
├── src/
│   ├── types.ts             # Shared type definitions
│   └── sources.ts           # Source tiers and trusted sites
db/
└── schema.sql               # Postgres schema (idempotent)
```

---

## Notes

- Frontend forms use native HTML form submission (action + method)
- All styling uses CSS classes from `globals.css`
- Admin pages use "legacy" class names — they work, low priority to update
