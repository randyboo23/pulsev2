# AGENTS.md -- Global Rules

These rules apply to all work in this repository.
Read and follow this file before taking any action.

---

## Core Principles
- Correctness > speed.
- Simplicity above all.
- Small, focused changes beat big refactors.
- Never guess. If something isn't known from files, ask.

---

## Reading Order (before coding)
1. This file: `AGENTS.md`
2. `memory.md` (current decisions, state, and lessons learned)
3. `docs/ARCHITECTURE.md` (system design, design system, file reference)
4. `README.md` (setup and operations)
5. Feature specs in `docs/` (if working on a specific feature)

---

## Workflow (mandatory)
1. **Read before acting**
   - Inspect relevant files before answering or coding.
2. **No speculation**
   - Never describe or modify code you haven't opened.
3. **Plan before major changes**
   - Any multi-file change, new feature, or architectural shift requires a short plan and approval.
4. **Minimal diffs**
   - Make the smallest change that solves the problem.
   - Avoid drive-by refactors or cleanup.
5. **Summarize**
   - After each step, explain:
     - what changed
     - why
     - how to test

---

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
- `packages/core/src/types.ts` -- all data shapes referenced across codebase
- Update types first when adding new data requirements

---

## Documentation Updates
- Update `memory.md` at the end of every session with decisions made and lessons learned.
- Update `docs/ARCHITECTURE.md` when data flow or system structure changes.
- Update `README.md` when new env vars, commands, or features are added.
- Update `AGENTS.md` when we discover a pattern or rule Claude should always follow.
- Commit documentation updates with related code changes, not separately.
- Do NOT create new documentation files unless explicitly asked.

---

## Planning Rules
- Multi-file or behavior-changing work requires a written plan first.
- Plans should include:
  - Goal (1 line)
  - Files affected
  - Steps (3-7 bullets)
  - Risks / assumptions
  - Test plan
- Plans may be stored in `plans/` temporarily.
- Plans are not sources of truth.

---

## Testing Expectations
- Any behavior change requires tests (where applicable).
- Bugfix flow:
  1. Add failing test
  2. Confirm failure
  3. Implement fix
  4. Confirm tests pass
- If tests are skipped, explain why.

---

## Code Quality
- Prefer TypeScript types where applicable.
- Functions should be small and single-purpose.
- Clear naming > comments.
- Avoid introducing new libraries unless necessary.

---

## Security & Repo Hygiene
- Never commit secrets (API keys, tokens, credentials).
- Never hardcode secrets -- use environment variables.
- Ensure `.gitignore` exists and includes:
  - `.env`, `.env.*`
  - `node_modules/`, `__pycache__/`
  - `*.log`
  - `.DS_Store`
- Before committing, verify no secrets are staged.

---

## Safety & Product Truth
- Never invent product behavior, features, or requirements.
- If information is missing or ambiguous: STOP and ask.
- Leaving something unfinished is better than guessing.

---

## Git Discipline
- Commit frequently with clear messages.
- Do not bundle unrelated changes.
- Each commit should have one logical purpose.
- Commit messages should describe what changed and why, not just which file was touched.

---

## Frontend & Design Quality (important)

When working on UI, pages, components, or styling:

### Design System: "The Broadsheet"
Editorial newspaper aesthetic with:
- **Fonts**: Playfair Display (headlines), Source Serif 4 (body), IBM Plex Sans (UI)
- **Colors**: Cream paper background (`#faf8f5`), ink text (`#1a1a18`), crimson accent (`#b8232f`)
- **Layout**: 12-column grid, 8-col main + 4-col sidebar

### Required design workflow
1. State the **aesthetic direction** in 1-2 lines (tone + intent).
2. Implement working code.
3. Do a **polish pass** (spacing, typography, states, accessibility).

### Design rules
- Avoid generic templates and cookie-cutter layouts.
- Avoid default/system fonts unless explicitly required.
- Avoid cliche SaaS gradients and purple-on-white palettes.
- Typography must be intentional:
  - Clear hierarchy
  - Consistent scale and line-height
- Use CSS variables/tokens for colors and spacing.
- Layout should feel intentional:
  - asymmetry, density, negative space, or clear rhythm
- Motion:
  - Prefer 1-2 meaningful interactions over many gimmicks
  - Respect reduced-motion preferences

### Quality bar
- Responsive
- Keyboard accessible
- Clear focus states
- Production-grade, not demo-quality

---

## Interaction Style
- Be concise.
- Ask 1-3 targeted questions if blocked.
- Otherwise, proceed with the smallest safe next step.

---

## Lessons Learned (add new entries as patterns emerge)
- Don't blacklist sources; deprioritize them via source tier instead.
- Always commit before starting new features or major changes.
- Firecrawl has a limited budget (3,000 credits/month on current plan). Use free HTML scrape first, fall back to Firecrawl only when needed. Tier A sources rarely need scraping.
- Edutopia content is mostly teacher blogs, not news. Keep at lowest source tier.
- When Claude API returns JSON, always strip markdown backticks and preamble before parsing.
