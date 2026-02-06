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
- Legacy synthetic phrasing classes (`coverage is converging on ...`, generic `why it matters` tails) are explicitly suppressed.

## Current Ranking Policy
- Ranking is deterministic with explainable breakdown fields.
- `story_type` is emitted as `breaking | policy | feature | evergreen | opinion`.
- Lead eligibility is explicit (`lead_eligible`, `lead_reason`) and used to avoid weak lead picks.
- Source authority now has stronger impact (nonlinear multiplier from source weight).
- Single-source low-authority clusters are demoted.
- Low-newsworthiness feature clusters (single-source, low-urgency, non-policy) are demoted by hard-news gate.
- Instructional evergreen content should not occupy top/lead slots unless urgency override signals exist.
- Malformed/generic titles (`slug permalinkurl...`, etc.) are filtered from ranked stories and wire display.

## Pipeline Notes
- Ingest runs on schedule through GitHub Actions.
- Manual `/admin/stories` backfill is recovery-only, not daily workflow.
- Current quality regressions come from weak input + forced fallback text.
- Runtime path remains in `apps/web`; `apps/worker` is deferred.

## Working Agreements
- Claude owns design/UI treatment.
- Codex owns backend functionality and data quality.
- Backend should pass clear rendering signals to UI (`preview_type`, `preview_confidence`).

## Near-Term Priorities
- Validate hard-news gate behavior on live ingest runs and tune thresholds.
- Add AI top-N reranker for editorial gravity (`scope`, `urgency`, `authority`, `audience_fit`).
- Improve clustering beyond lexical `story_key` when ranking quality stabilizes.

## Open Questions
- Final threshold values for hard-news gate penalties.
- Whether to add a strict `story_type=evergreen` exclusion from lead slots in all cases.
