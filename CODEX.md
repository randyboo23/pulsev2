# Codex Backend Guidelines for Pulse K-12

This document defines the division of labor between Codex (backend/engine) and Claude (design/frontend) for this project.

## Division of Labor

### Codex Owns (Backend/Engine)
- Database schema and migrations (`db/`)
- API endpoints (`apps/web/app/api/`)
- Data ingestion, enrichment, clustering (`apps/worker/`)
- Business logic in `src/lib/` (ranking, grouping, articles, stories)
- Authentication and admin logic
- External service integrations (RSS, email providers, etc.)
- Type definitions in `packages/core/src/types.ts` (shared contract)

### Claude Owns (Design/Frontend)
- All `.tsx` page components (`apps/web/app/**/page.tsx`)
- Global styles (`apps/web/app/globals.css`)
- Layout and visual hierarchy
- Responsive design
- UI states (loading, empty, error)
- Form styling and client-side validation UX

### Shared Contract
- `packages/core/src/types.ts` - Both sides reference this for data shapes
- When adding new data requirements, update types first

---

## Current Frontend State

### Design System: "The Broadsheet"
Editorial newspaper aesthetic with:
- **Fonts**: Playfair Display (headlines), Source Serif 4 (body), IBM Plex Sans (UI)
- **Colors**: Cream paper background (`#faf8f5`), ink text (`#1a1a18`), crimson accent (`#b8232f`)
- **Layout**: 12-column grid, 8-col main + 4-col sidebar

### Pages
| Route | Status | Notes |
|-------|--------|-------|
| `/` | Complete | Homepage with masthead, nav, newsletter bar, featured story, story grid, wire sidebar |
| `/stories/[id]` | Complete | Story detail with sources list |
| `/admin/stories` | Functional | Uses legacy classes, works fine |
| `/admin/sources` | Functional | Uses legacy classes |
| `/newsletter` | **Needs page** | Nav link exists, page doesn't |

### UI Elements Awaiting Backend

#### 1. Newsletter Subscription
**Location**: Above-fold bar + footer form
**Forms POST to**: `/api/newsletter/subscribe`
**Expected payload**:
```typescript
{ email: string }
```
**Expected response**:
```typescript
{ success: boolean; message?: string }
```
**Backend tasks**:
- Create `subscribers` table (email, created_at, confirmed, etc.)
- Create `/api/newsletter/subscribe` endpoint
- Integrate with email service (Resend, Buttondown, etc.)
- Optional: double opt-in flow

#### 2. Category Filtering (Future)
**Location**: Nav bar links (Policy, Classroom, EdTech, Leadership)
**Currently**: All link to `/` (placeholder)
**When ready**: Change to `/category/[slug]` or `/?category=[slug]`
**Backend tasks**:
- Add `category` field to stories or articles
- Update `getTopStories()` to accept category filter
- Categorization logic (manual tags? LLM classification?)

---

## How to Coordinate

### Adding a New Feature

1. **Define the contract first**
   - What data does the frontend need?
   - Add/update types in `packages/core/src/types.ts`

2. **Backend implements**
   - Database changes
   - API endpoints
   - Let frontend know when ready

3. **Frontend wires up**
   - Connect UI to real endpoints
   - Add loading/error states

### Example: Newsletter

Backend checklist:
- [ ] Create `subscribers` table
- [ ] Create `POST /api/newsletter/subscribe` endpoint
- [ ] Return `{ success: true }` or `{ success: false, message: "..." }`
- [ ] (Optional) Email confirmation flow

Frontend will then:
- Add client-side form handling with success/error feedback
- Show loading state on submit
- Display success message or error

---

## File Reference

```
apps/web/
├── app/
│   ├── globals.css          # All styles (Claude owns)
│   ├── layout.tsx           # Root layout with footer (Claude owns)
│   ├── page.tsx             # Homepage (Claude owns)
│   ├── stories/[id]/page.tsx
│   ├── admin/               # Admin pages
│   └── api/                 # API routes (Codex owns)
│       └── newsletter/
│           └── subscribe/
│               └── route.ts # TO BE CREATED
├── src/lib/
│   ├── stories.ts           # Story queries (Codex owns)
│   ├── articles.ts          # Article queries (Codex owns)
│   ├── ranking.ts           # Scoring logic (Codex owns)
│   └── db.ts                # Database connection
```

---

## Notes

- Frontend forms use native HTML form submission (action + method)
- Forms can be enhanced with client JS later for better UX
- All styling uses CSS classes from `globals.css`
- Admin pages use "legacy" class names - they work, low priority to update
