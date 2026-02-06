# Pulse Memory

Purpose:
- Shared decision memory for Codex + Claude so we do not re-litigate product choices.
- Keep this short and current.
- Record decisions and constraints, not long explanations.

Last updated:
- 2026-02-06

## Product Direction
- Build a Techmeme-style homepage for US K-12 education news.
- Prioritize signal over volume.
- AI is used as judge/filter first, generator second.
- Human/editorial overrides remain available.

## Current Summary Policy
- Homepage preview contract uses:
- `preview_type`: `full` | `excerpt` | `headline_only` | `synthetic`
- `preview_confidence`: `0..1`
- Fallback/synthetic text is stored for debugging but not shown to users.
- If preview confidence is low, render headline-only.
- Headline-only is preferred over generic filler blurbs.

## Pipeline Notes
- Ingest runs on schedule through GitHub Actions.
- Manual `/admin/stories` backfill is recovery-only, not daily workflow.
- Current quality regressions come from weak input + forced fallback text.
- Phase 1 focus is confidence gating and preview suppression of synthetic/fallback.

## Working Agreements
- Claude owns design/UI treatment.
- Codex owns backend functionality and data quality.
- Backend should pass clear rendering signals to UI (`preview_type`, `preview_confidence`).

## Near-Term Priorities
- Stabilize preview quality with `headline_only` fallback behavior.
- Add candidate adjudication quality metrics and monitoring.
- Improve clustering/ranking after summary quality is stable.

## Open Questions
- Final threshold for low-confidence preview suppression.
- Hero slot rules when top-ranked story is `headline_only`.
