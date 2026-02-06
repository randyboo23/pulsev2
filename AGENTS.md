# AGENTS.md — Global Rules

These rules apply to all work in this repository.
Read and follow this file before taking any action.

---

## Core Principles
- Correctness > speed.
- Simplicity above all.
- Small, focused changes beat big refactors.
- Never guess. If something isn’t known from files, ask.

---

## Workflow (mandatory)
1. **Read before acting**
   - Inspect relevant files before answering or coding.
2. **No speculation**
   - Never describe or modify code you haven’t opened.
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

## Reading Order (before coding)
1. `README.md`
2. `ARCHITECTURE.md` (if present)
3. Feature or planning docs (if present)
4. This file: `AGENTS.md`

---

## Planning Rules
- Multi-file or behavior-changing work requires a written plan first.
- Plans should include:
  - Goal (1 line)
  - Files affected
  - Steps (3–7 bullets)
  - Risks / assumptions
  - Test plan
- Plans may be stored in `plans/` temporarily.
- Plans are not sources of truth.

---

## Documentation Rules
- Docs are contracts, not explanations.
- Bullets over prose.
- Update docs in the same session as code changes.
- Do NOT create new documentation files unless explicitly asked.

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
- Never hardcode secrets — use environment variables.
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

---

## Frontend & Design Quality (important)

When working on UI, pages, components, or styling:

### Required design workflow
1. State the **aesthetic direction** in 1–2 lines (tone + intent).
2. Implement working code.
3. Do a **polish pass** (spacing, typography, states, accessibility).

### Design rules
- Avoid generic templates and cookie-cutter layouts.
- Avoid default/system fonts unless explicitly required.
- Avoid cliché SaaS gradients and purple-on-white palettes.
- Typography must be intentional:
  - Clear hierarchy
  - Consistent scale and line-height
- Use CSS variables/tokens for colors and spacing.
- Layout should feel intentional:
  - asymmetry, density, negative space, or clear rhythm
- Motion:
  - Prefer 1–2 meaningful interactions over many gimmicks
  - Respect reduced-motion preferences

### Quality bar
- Responsive
- Keyboard accessible
- Clear focus states
- Production-grade, not demo-quality

---

## Interaction Style
- Be concise.
- Ask 1–3 targeted questions if blocked.
- Otherwise, proceed with the smallest safe next step.
