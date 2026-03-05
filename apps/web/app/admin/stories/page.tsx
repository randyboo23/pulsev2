import { redirect } from "next/navigation";
import { isAdmin } from "@/src/lib/admin";
import { pool } from "@/src/lib/db";
import { getTopStories } from "@/src/lib/stories";
import AdminSubmitButton from "@/src/components/AdminSubmitButton";
import {
  updateStory,
  mergeStory,
  hideInternational,
  demoteStory,
  sendGuardrailTestEmail,
  sendTopStoryLinkedInDraftEmail
} from "./actions";

export const dynamic = "force-dynamic";

type TopArticlePreview = {
  title: string | null;
  url: string;
  source: string | null;
};

type StoryAdminRow = {
  id: string;
  story_key: string | null;
  title: string;
  summary: string | null;
  editor_title: string | null;
  editor_summary: string | null;
  status: "active" | "pinned" | "demoted" | "hidden" | null;
  last_seen_at: string;
  article_count: number | null;
  source_names: string[] | null;
  top_articles: TopArticlePreview[] | null;
};

type MergeCandidate = {
  source: StoryAdminRow;
  target: StoryAdminRow;
  overlap: number;
};

type CleanupEventRow = {
  created_at: string;
  detail:
    | {
        deleted_articles?: number;
        deleted_stories?: number;
      }
    | null;
};

type TopStoryDuplicateAuditPair = {
  leftStoryId: string;
  rightStoryId: string;
  leftRank: number;
  rightRank: number;
  leftTitle: string;
  rightTitle: string;
  ratio: number;
  sharedTokens: number;
  sharedActionTokens: number;
  sharedStrongTokens: number;
};

type DuplicateGuardrailDetail = {
  guardrailAlerts?: string[];
  topStoryDuplicateAuditChecked?: number;
  topStoryDuplicateAuditThreshold?: number;
  topStoryDuplicateAuditSimilarity?: number;
  topStoryDuplicateAuditPairs?: TopStoryDuplicateAuditPair[];
};

type DuplicateGuardrailEventRow = {
  created_at: string;
  detail: DuplicateGuardrailDetail | null;
};

type DuplicateGuardrailAlert = {
  createdAt: string;
  pairCount: number;
  checked: number;
  similarity: number;
  pairs: TopStoryDuplicateAuditPair[];
};

type GuardrailEmailEventDetail = {
  alertType?: string;
  sent?: boolean;
  to?: unknown;
  error?: string;
};

type GuardrailEmailEventRow = {
  created_at: string;
  detail: GuardrailEmailEventDetail | null;
};

type GuardrailTestEmailStatus = {
  createdAt: string;
  sent: boolean;
  recipients: string[];
  error: string | null;
};

type GuardrailHealthTopGateRow = {
  gate_runs: number | string | null;
  premerge_suggested: number | string | null;
  premerge_merged: number | string | null;
  gate_demoted: number | string | null;
  last_gate_at: string | null;
};

type GuardrailHealthDuplicateAlertRow = {
  duplicate_alert_runs: number | string | null;
  duplicate_pairs: number | string | null;
};

type GuardrailHealthEmailRow = {
  duplicate_emails_sent: number | string | null;
};

type GuardrailHealthSummary = {
  gateRuns: number;
  premergeSuggested: number;
  premergeMerged: number;
  gateDemoted: number;
  duplicateAlertRuns: number;
  duplicatePairs: number;
  duplicateEmailsSent: number;
  lastGateAt: string | null;
};

function parseTopStoryDuplicateAlertCount(alerts: string[] | undefined) {
  if (!Array.isArray(alerts)) return 0;
  const duplicateAlert = alerts.find((value) => value.startsWith("top_story_duplicate_pairs:"));
  if (!duplicateAlert) return 0;
  const parts = duplicateAlert.split(":");
  if (parts.length < 2) return 0;
  const parsed = Number(parts[1]);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function toDuplicatePairs(rawPairs: unknown): TopStoryDuplicateAuditPair[] {
  if (!Array.isArray(rawPairs)) return [];

  return rawPairs
    .map((pair) => {
      if (!pair || typeof pair !== "object") return null;
      const data = pair as Record<string, unknown>;
      const leftStoryId = String(data.leftStoryId ?? "").trim();
      const rightStoryId = String(data.rightStoryId ?? "").trim();
      const leftTitle = String(data.leftTitle ?? "").trim();
      const rightTitle = String(data.rightTitle ?? "").trim();
      const leftRank = Number(data.leftRank ?? 0);
      const rightRank = Number(data.rightRank ?? 0);
      const ratio = Number(data.ratio ?? 0);
      const sharedTokens = Number(data.sharedTokens ?? 0);
      const sharedActionTokens = Number(data.sharedActionTokens ?? 0);
      const sharedStrongTokens = Number(data.sharedStrongTokens ?? 0);
      if (!leftStoryId || !rightStoryId || !leftTitle || !rightTitle) return null;
      if (!Number.isFinite(leftRank) || !Number.isFinite(rightRank)) return null;
      return {
        leftStoryId,
        rightStoryId,
        leftRank,
        rightRank,
        leftTitle,
        rightTitle,
        ratio: Number.isFinite(ratio) ? ratio : 0,
        sharedTokens: Number.isFinite(sharedTokens) ? sharedTokens : 0,
        sharedActionTokens: Number.isFinite(sharedActionTokens) ? sharedActionTokens : 0,
        sharedStrongTokens: Number.isFinite(sharedStrongTokens) ? sharedStrongTokens : 0
      };
    })
    .filter((pair): pair is TopStoryDuplicateAuditPair => Boolean(pair));
}

function toStringArray(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);
}

function sanitizeEmailErrorForDisplay(raw: string | null) {
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const redactedAuthCommand = collapsed.replace(
    /for\s+"[A-Za-z0-9+/=]{8,}"/gi,
    'for "[AUTH_REDACTED]"'
  );
  const redactedGeneric = redactedAuthCommand.replace(/[A-Za-z0-9+/=]{24,}/g, "[REDACTED]");
  return redactedGeneric;
}

function toSafeInt(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export default async function AdminStoriesPage() {
  if (!isAdmin()) {
    redirect("/admin/login");
  }

  const result = await pool.query(
    `select
      s.id,
      s.story_key,
      s.title,
      s.summary,
      s.editor_title,
      s.editor_summary,
      s.status,
      s.last_seen_at,
      stats.article_count,
      stats.source_names,
      ta.top_articles
     from stories s
     left join (
       select
         sa.story_id,
         count(sa.article_id) as article_count,
         array_agg(distinct src.name) filter (where src.name is not null) as source_names
       from story_articles sa
       left join articles a on a.id = sa.article_id
       left join sources src on src.id = a.source_id
       group by sa.story_id
     ) stats on stats.story_id = s.id
     left join lateral (
       select json_agg(
         json_build_object(
           'title', a2.title,
           'url', a2.url,
           'source', src2.name
         )
       ) as top_articles
       from (
         select a1.id, a1.title, a1.url, a1.published_at, a1.fetched_at, a1.source_id
         from story_articles sa2
         join articles a1 on a1.id = sa2.article_id
         where sa2.story_id = s.id
         order by coalesce(a1.published_at, a1.fetched_at) desc
         limit 3
       ) a2
       left join sources src2 on src2.id = a2.source_id
     ) ta on true
    order by s.last_seen_at desc
    limit 200`
  );
  const stories = result.rows as StoryAdminRow[];
  let topStoryIds: string[] = [];
  try {
    const topStories = await getTopStories(20);
    topStoryIds = topStories.map((story) => story.id);
  } catch (error) {
    console.error(
      `[admin/stories] failed to load top stories: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const topStoryPrimaryCount = Math.min(10, topStoryIds.length);
  const topStoryNextCount = Math.max(0, topStoryIds.length - topStoryPrimaryCount);
  const topStoryOrder = new Map(topStoryIds.map((id, index) => [id, index]));
  const orderedStories = [...stories].sort((a, b) => {
    const aRank = topStoryOrder.has(a.id) ? (topStoryOrder.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const bRank = topStoryOrder.has(b.id) ? (topStoryOrder.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
  });

  let lastCleanup: string | undefined;
  let lastCleanupStats: { deleted_articles?: number; deleted_stories?: number } | undefined;
  try {
    const cleanupResult = await pool.query<CleanupEventRow>(
      `select created_at, detail
       from admin_events
       where event_type = 'cleanup_international'
       order by created_at desc
       limit 1`
    );
    lastCleanup = cleanupResult.rows[0]?.created_at as string | undefined;
    const detail = cleanupResult.rows[0]?.detail ?? undefined;
    if (detail) {
      lastCleanupStats = {
        deleted_articles: Number(detail.deleted_articles ?? 0),
        deleted_stories: Number(detail.deleted_stories ?? 0)
      };
    }
  } catch {
    lastCleanup = undefined;
  }

  let duplicateGuardrailAlerts: DuplicateGuardrailAlert[] = [];
  try {
    const duplicateResult = await pool.query<DuplicateGuardrailEventRow>(
      `select created_at, detail
       from admin_events
       where event_type = 'ingest_guardrail_alert'
         and detail::text ilike '%top_story_duplicate_pairs:%'
       order by created_at desc
       limit 5`
    );
    duplicateGuardrailAlerts = duplicateResult.rows
      .map((row) => {
        const detail = row.detail ?? null;
        if (!detail) return null;
        const pairs = toDuplicatePairs(detail.topStoryDuplicateAuditPairs);
        const pairCountFromAlert = parseTopStoryDuplicateAlertCount(detail.guardrailAlerts);
        const pairCount = pairCountFromAlert > 0 ? pairCountFromAlert : pairs.length;
        return {
          createdAt: row.created_at,
          pairCount,
          checked: Number(detail.topStoryDuplicateAuditChecked ?? 0),
          similarity: Number(detail.topStoryDuplicateAuditSimilarity ?? 0),
          pairs
        };
      })
      .filter((row): row is DuplicateGuardrailAlert => Boolean(row));
  } catch {
    duplicateGuardrailAlerts = [];
  }

  let latestGuardrailTestEmail: GuardrailTestEmailStatus | null = null;
  try {
    const emailResult = await pool.query<GuardrailEmailEventRow>(
      `select created_at, detail
       from admin_events
       where event_type = 'ingest_guardrail_email'
         and coalesce(detail->>'alertType', '') = 'top_story_duplicate_test'
       order by created_at desc
       limit 1`
    );
    const event = emailResult.rows[0];
    const detail = event?.detail ?? null;
    if (event && detail) {
      latestGuardrailTestEmail = {
        createdAt: event.created_at,
        sent: detail.sent === true,
        recipients: toStringArray(detail.to),
        error: detail.error ? sanitizeEmailErrorForDisplay(String(detail.error)) : null
      };
    }
  } catch {
    latestGuardrailTestEmail = null;
  }

  let guardrailHealth: GuardrailHealthSummary = {
    gateRuns: 0,
    premergeSuggested: 0,
    premergeMerged: 0,
    gateDemoted: 0,
    duplicateAlertRuns: 0,
    duplicatePairs: 0,
    duplicateEmailsSent: 0,
    lastGateAt: null
  };
  try {
    const topGate = await pool.query<GuardrailHealthTopGateRow>(
      `select
         count(*)::int as gate_runs,
         coalesce(sum(coalesce((detail->'topStoryPremerge'->>'suggested')::int, 0)), 0)::int as premerge_suggested,
         coalesce(sum(coalesce((detail->'topStoryPremerge'->>'merged')::int, 0)), 0)::int as premerge_merged,
         coalesce(sum(coalesce((detail->>'demoted')::int, 0)), 0)::int as gate_demoted,
         max(created_at) as last_gate_at
       from admin_events
       where event_type = 'ingest_top_story_gate'
         and created_at >= now() - interval '24 hours'`
    );
    const duplicateAlerts = await pool.query<GuardrailHealthDuplicateAlertRow>(
      `select
         count(*)::int as duplicate_alert_runs,
         coalesce(sum(split_part(alert.value, ':', 2)::int), 0)::int as duplicate_pairs
       from admin_events e
       cross join lateral jsonb_array_elements_text(coalesce(e.detail->'guardrailAlerts', '[]'::jsonb)) as alert(value)
       where e.event_type = 'ingest_guardrail_alert'
         and e.created_at >= now() - interval '24 hours'
         and alert.value like 'top_story_duplicate_pairs:%'`
    );
    const duplicateEmails = await pool.query<GuardrailHealthEmailRow>(
      `select
         count(*) filter (where coalesce((detail->>'sent')::boolean, false))::int as duplicate_emails_sent
       from admin_events
       where event_type = 'ingest_guardrail_email'
         and created_at >= now() - interval '24 hours'
         and coalesce(detail->>'alertType', '') = 'top_story_duplicate_pairs'`
    );

    const gateRow = topGate.rows[0];
    const alertRow = duplicateAlerts.rows[0];
    const emailRow = duplicateEmails.rows[0];
    guardrailHealth = {
      gateRuns: toSafeInt(gateRow?.gate_runs),
      premergeSuggested: toSafeInt(gateRow?.premerge_suggested),
      premergeMerged: toSafeInt(gateRow?.premerge_merged),
      gateDemoted: toSafeInt(gateRow?.gate_demoted),
      duplicateAlertRuns: toSafeInt(alertRow?.duplicate_alert_runs),
      duplicatePairs: toSafeInt(alertRow?.duplicate_pairs),
      duplicateEmailsSent: toSafeInt(emailRow?.duplicate_emails_sent),
      lastGateAt: gateRow?.last_gate_at ? String(gateRow.last_gate_at) : null
    };
  } catch {
    guardrailHealth = {
      gateRuns: 0,
      premergeSuggested: 0,
      premergeMerged: 0,
      gateDemoted: 0,
      duplicateAlertRuns: 0,
      duplicatePairs: 0,
      duplicateEmailsSent: 0,
      lastGateAt: null
    };
  }

  const candidates: MergeCandidate[] = [];
  const maxCandidates = 8;
  const windowDays = 4;
  const threshold = 0.6;

  function toTokens(storyKey: string | null) {
    if (!storyKey) return [];
    return storyKey.split("-").filter((token) => token.length > 0);
  }

  function jaccard(a: string[], b: string[]) {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) intersection += 1;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  const mergePool = stories.filter((story) => story.status !== "hidden");

  for (let i = 0; i < mergePool.length; i += 1) {
    for (let j = i + 1; j < mergePool.length; j += 1) {
      const a = mergePool[i];
      const b = mergePool[j];
      const aDate = new Date(a.last_seen_at);
      const bDate = new Date(b.last_seen_at);
      const daysApart = Math.abs(aDate.getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysApart > windowDays) continue;

      const overlap = jaccard(toTokens(a.story_key), toTokens(b.story_key));
      if (overlap < threshold) continue;

      const aCount = Number(a.article_count ?? 0);
      const bCount = Number(b.article_count ?? 0);
      const target = aCount > bCount || (aCount === bCount && aDate >= bDate) ? a : b;
      const source = target.id === a.id ? b : a;

      candidates.push({
        source,
        target,
        overlap
      });

      if (candidates.length >= maxCandidates) break;
    }
    if (candidates.length >= maxCandidates) break;
  }

  const latestDuplicateAlert = duplicateGuardrailAlerts[0] ?? null;
  const latestDuplicatePairs = latestDuplicateAlert?.pairs ?? [];
  const needsReviewCount =
    latestDuplicatePairs.length > 0
      ? latestDuplicatePairs.length
      : Number(latestDuplicateAlert?.pairCount ?? 0);
  const hasNeedsReview = needsReviewCount > 0;
  const lastIngestLabel = guardrailHealth.lastGateAt
    ? new Date(guardrailHealth.lastGateAt).toLocaleString("en-US")
    : "No ingest in 24h";

  const topPrimaryStories = orderedStories.filter((story) => {
    const rank = topStoryOrder.get(story.id);
    return rank !== undefined && rank < 10;
  });
  const topNextStories = orderedStories.filter((story) => {
    const rank = topStoryOrder.get(story.id);
    return rank !== undefined && rank >= 10 && rank < 20;
  });
  const otherStories = orderedStories.filter((story) => !topStoryOrder.has(story.id));

  const renderStoryEditorCard = (story: StoryAdminRow) => {
    const topRank = topStoryOrder.get(story.id);

    return (
      <div className="story" key={story.id}>
        {topRank !== undefined ? (
          <div className="meta">
            {topRank < 10 ? `Homepage Top #${topRank + 1}` : `Homepage Next #${topRank + 1}`}
          </div>
        ) : null}
        <div className="meta">
          Updated {new Date(story.last_seen_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
          })}{" "}
          · {story.article_count ?? 0} sources
        </div>
        {story.source_names?.length ? (
          <div className="meta">
            {story.source_names.slice(0, 3).join(", ")}
            {story.source_names.length > 3
              ? ` +${story.source_names.length - 3} more`
              : ""}
          </div>
        ) : null}
        {story.top_articles?.length ? (
          <div className="preview-list">
            {story.top_articles.map((item, index) => (
              <div className="preview-item" key={`${story.id}-preview-${index}`}>
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title ?? "Untitled"}
                </a>
                <span>{item.source ?? "Unknown"}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="meta">
          <a href={`/stories/${story.id}`} className="admin-link">
            View story
          </a>
        </div>
        <form action={updateStory} className="story-list">
          <input type="hidden" name="id" value={story.id} />
          <label style={{ fontSize: "12px", color: "var(--ink-faded)" }}>Status</label>
          <select
            name="status"
            defaultValue={story.status ?? "active"}
            style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--rule)" }}
          >
            <option value="active">active</option>
            <option value="pinned">pinned</option>
            <option value="demoted">demoted</option>
            <option value="hidden">hidden</option>
          </select>
          <label style={{ fontSize: "12px", color: "var(--ink-faded)" }}>Editor title</label>
          <input
            type="text"
            name="editor_title"
            defaultValue={story.editor_title ?? ""}
            placeholder={story.title}
            style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--rule)" }}
          />
          <label style={{ fontSize: "12px", color: "var(--ink-faded)" }}>Editor summary</label>
          <textarea
            name="editor_summary"
            defaultValue={story.editor_summary ?? ""}
            placeholder={story.summary ?? ""}
            rows={3}
            style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--rule)" }}
          />
          <AdminSubmitButton className="admin-action" pendingLabel="Saving..." successLabel="Saved">
            Save
          </AdminSubmitButton>
        </form>

        <div className="admin-action-row" style={{ marginTop: "8px" }}>
          <form action={demoteStory}>
            <input type="hidden" name="id" value={story.id} />
            <AdminSubmitButton
              className="admin-action admin-action-secondary"
              pendingLabel="Demoting..."
              successLabel="Demoted"
            >
              Demote on homepage
            </AdminSubmitButton>
          </form>
        </div>

        <details className="admin-inline-details" style={{ marginTop: "8px" }}>
          <summary className="admin-link">More actions</summary>
          <div className="story-list" style={{ gap: "8px", marginTop: "8px" }}>
            <form action={hideInternational}>
              <input type="hidden" name="id" value={story.id} />
              <AdminSubmitButton
                className="admin-action admin-action-secondary"
                pendingLabel="Hiding..."
                successLabel="Hidden"
              >
                Hide as international
              </AdminSubmitButton>
            </form>

            <form action={mergeStory} className="story-list">
              <input type="hidden" name="source_id" value={story.id} />
              <label style={{ fontSize: "12px", color: "var(--ink-faded)" }}>Merge into</label>
              <input
                type="text"
                name="target_id"
                placeholder="Target story id"
                list="story-ids"
                style={{ padding: "8px", borderRadius: "8px", border: "1px solid var(--rule)" }}
              />
              <AdminSubmitButton
                className="admin-action admin-action-secondary"
                pendingLabel="Merging..."
                successLabel="Merged"
              >
                Merge
              </AdminSubmitButton>
            </form>
          </div>
        </details>
      </div>
    );
  };

  return (
    <main className="main">
      <header className="header">
        <div>
          <div className="brand">Pulse K-12</div>
          <div className="tagline">Admin · Stories</div>
        </div>
        <div className="filters">
          <a className="filter" href="/admin/feeds">Feeds</a>
          <a className="filter" href="/admin/sources">Sources</a>
          <a className="filter" href="/">Home</a>
        </div>
      </header>

      <section className="card">
        <h2>Guardrails</h2>
        <p>Editorial health at a glance and quick actions for possible duplicate stories.</p>
        <div className="admin-stat-grid" style={{ marginTop: "12px" }}>
          <div className={`admin-stat-card ${hasNeedsReview ? "is-alert" : "is-ok"}`}>
            <div className="admin-stat-label">Needs review now</div>
            <div className="admin-stat-value">{needsReviewCount}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-label">Last ingest</div>
            <div className="admin-stat-value admin-stat-value-small">{lastIngestLabel}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-label">Auto-merged stories (24h)</div>
            <div className="admin-stat-value">
              {guardrailHealth.premergeMerged}/{guardrailHealth.premergeSuggested}
            </div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-label">Possible duplicates found (24h)</div>
            <div className="admin-stat-value">{guardrailHealth.duplicatePairs}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-label">Stories moved down (24h)</div>
            <div className="admin-stat-value">{guardrailHealth.gateDemoted}</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-label">Duplicate alert emails sent (24h)</div>
            <div className="admin-stat-value">{guardrailHealth.duplicateEmailsSent}</div>
          </div>
        </div>
        <div className="admin-action-row" style={{ marginTop: "12px" }}>
          <form action={sendGuardrailTestEmail}>
            <AdminSubmitButton
              className="admin-action admin-action-secondary"
              pendingLabel="Sending..."
              successLabel="Sent"
            >
              Send test guardrail email
            </AdminSubmitButton>
          </form>
          <form action={sendTopStoryLinkedInDraftEmail}>
            <AdminSubmitButton
              className="admin-action admin-action-secondary"
              pendingLabel="Sending..."
              successLabel="Sent"
            >
              Send top-story LinkedIn draft
            </AdminSubmitButton>
          </form>
        </div>
        <div className="admin-inline-note">
          {latestGuardrailTestEmail
            ? `Last test ${latestGuardrailTestEmail.sent ? "sent" : "failed"} ${new Date(
                latestGuardrailTestEmail.createdAt
              ).toLocaleString("en-US")}${
                latestGuardrailTestEmail.recipients.length > 0
                  ? ` · to ${latestGuardrailTestEmail.recipients.join(", ")}`
                  : ""
              }${
                !latestGuardrailTestEmail.sent && latestGuardrailTestEmail.error
                  ? ` · ${latestGuardrailTestEmail.error.slice(0, 120)}`
                  : ""
              }`
            : "No test email run yet"}
        </div>
        <div className="meta" style={{ marginTop: "12px" }}>
          `Merge (Recommended)` combines two versions of the same event into one story. `Move lower story down` keeps both stories but removes the weaker one from top slots.
        </div>
        {!hasNeedsReview ? (
          <div className="story" style={{ marginTop: "12px", borderColor: "var(--rule)" }}>
            <div className="meta">No possible duplicate stories need review right now.</div>
          </div>
        ) : (
          <div className="story-list">
            <h3>Needs Review</h3>
            <div className="meta">
              {latestDuplicateAlert
                ? `Detected ${new Date(latestDuplicateAlert.createdAt).toLocaleString("en-US")} · ${latestDuplicateAlert.pairCount} possible duplicate pair${latestDuplicateAlert.pairCount === 1 ? "" : "s"}`
                : "Possible duplicate stories detected"}
            </div>
            {latestDuplicatePairs.length > 0 ? (
              latestDuplicatePairs.map((pair, pairIndex) => {
                const targetIsLeft = pair.leftRank <= pair.rightRank;
                const targetId = targetIsLeft ? pair.leftStoryId : pair.rightStoryId;
                const targetTitle = targetIsLeft ? pair.leftTitle : pair.rightTitle;
                const targetRank = targetIsLeft ? pair.leftRank : pair.rightRank;
                const sourceId = targetIsLeft ? pair.rightStoryId : pair.leftStoryId;
                const sourceTitle = targetIsLeft ? pair.rightTitle : pair.leftTitle;
                const sourceRank = targetIsLeft ? pair.rightRank : pair.leftRank;

                return (
                  <div className="story" key={`review-pair-${pairIndex}`} style={{ marginTop: "12px" }}>
                    <h3>
                      Possible duplicate: #{pair.leftRank} and #{pair.rightRank}
                    </h3>
                    <div className="preview-list">
                      <div className="preview-item">
                        <strong>#{pair.leftRank}: {pair.leftTitle}</strong>
                        <a href={`/stories/${pair.leftStoryId}`} className="admin-link">View story</a>
                      </div>
                      <div className="preview-item">
                        <strong>#{pair.rightRank}: {pair.rightTitle}</strong>
                        <a href={`/stories/${pair.rightStoryId}`} className="admin-link">View story</a>
                      </div>
                    </div>
                    <div className="story-list" style={{ gap: "8px", marginTop: "8px" }}>
                      <form action={mergeStory}>
                        <input type="hidden" name="source_id" value={sourceId} />
                        <input type="hidden" name="target_id" value={targetId} />
                        <AdminSubmitButton
                          className="admin-action"
                          pendingLabel="Merging..."
                          successLabel="Merged"
                        >
                          Merge (Recommended): #{sourceRank} into #{targetRank}
                        </AdminSubmitButton>
                      </form>
                      <div className="meta">
                        Recommended merge target is #{targetRank} because it is ranked higher on the homepage.
                      </div>
                      <form action={demoteStory}>
                        <input type="hidden" name="id" value={sourceId} />
                        <AdminSubmitButton
                          className="admin-action admin-action-secondary"
                          pendingLabel="Demoting..."
                          successLabel="Done"
                        >
                          Move lower story down (#{sourceRank})
                        </AdminSubmitButton>
                      </form>
                      <div className="meta">
                        Use this if they are related but not truly the same event.
                      </div>
                    </div>
                    <details style={{ marginTop: "10px" }}>
                      <summary className="admin-link">Show technical details</summary>
                      <div className="meta">
                        overlap {Math.round(pair.ratio * 100)}% · shared {pair.sharedTokens} · action {pair.sharedActionTokens} · strong {pair.sharedStrongTokens}
                      </div>
                      <div className="meta">
                        IDs: {pair.leftStoryId} · {pair.rightStoryId}
                      </div>
                      <div className="meta">
                        Recommended target: #{targetRank} {targetTitle}
                      </div>
                      <div className="meta">
                        Lower-ranked source: #{sourceRank} {sourceTitle}
                      </div>
                    </details>
                  </div>
                );
              })
            ) : (
              <div className="story" style={{ marginTop: "12px", borderColor: "var(--rule)" }}>
                <div className="meta">
                  A duplicate alert was logged, but pair details were not included in that run.
                </div>
              </div>
            )}
          </div>
        )}
        {duplicateGuardrailAlerts.length > 0 ? (
          <details style={{ marginTop: "12px" }}>
            <summary className="admin-link">Recent duplicate alert history (last 5)</summary>
            <div className="story-list" style={{ marginTop: "8px" }}>
              {duplicateGuardrailAlerts.map((alert, alertIndex) => (
                <div className="meta" key={`alert-history-${alertIndex}`}>
                  {new Date(alert.createdAt).toLocaleString("en-US")} · {alert.pairCount} pair
                  {alert.pairCount === 1 ? "" : "s"} · checked top {alert.checked || 10}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="card">
        <h2>Stories</h2>
        <p>Adjust status, edit titles, or merge duplicates.</p>
        <div className="admin-badge-row" style={{ marginTop: "12px" }}>
          <span className="admin-badge">US-only filter enabled</span>
          <span className="admin-badge">
            Last cleanup {lastCleanup ? new Date(lastCleanup).toLocaleString("en-US") : "never"}
          </span>
          <span className="admin-badge">Homepage Top 10 loaded: {topStoryPrimaryCount}</span>
          <span className="admin-badge">Next 10 watchlist: {topStoryNextCount}</span>
          {lastCleanupStats ? (
            <span className="admin-badge">
              {lastCleanupStats.deleted_articles ?? 0} articles, {lastCleanupStats.deleted_stories ?? 0} stories removed
            </span>
          ) : null}
        </div>
        <details className="admin-inline-details" style={{ marginTop: "12px" }}>
          <summary className="admin-link">Advanced maintenance actions</summary>
          <div className="admin-action-row" style={{ marginTop: "10px" }}>
            <form action="/api/admin/cleanup-international" method="post">
              <AdminSubmitButton
                className="admin-action admin-action-secondary"
                pendingLabel="Running..."
                successLabel="Done"
              >
                Re-run international cleanup
              </AdminSubmitButton>
            </form>
            <form action="/api/admin/generate-summaries" method="post">
              <AdminSubmitButton
                className="admin-action admin-action-secondary"
                pendingLabel="Running..."
                successLabel="Done"
              >
                Backfill story briefs (manual)
              </AdminSubmitButton>
            </form>
          </div>
        </details>
        {candidates.length > 0 ? (
          <div className="story-list">
            <h3>Suggested merges</h3>
            {candidates.map((pair, index) => (
              <div className="story" key={`suggest-${index}`}>
                <div className="meta">Similarity {Math.round(pair.overlap * 100)}%</div>
                <div className="preview-list">
                  <div className="preview-item">
                    <strong>{pair.source.editor_title ?? pair.source.title}</strong>
                    <span>{pair.source.article_count ?? 0} sources</span>
                  </div>
                  <div className="preview-item">
                    <strong>{pair.target.editor_title ?? pair.target.title}</strong>
                    <span>{pair.target.article_count ?? 0} sources</span>
                  </div>
                </div>
                <form action={mergeStory} className="story-list">
                  <input type="hidden" name="source_id" value={pair.source.id} />
                  <input type="hidden" name="target_id" value={pair.target.id} />
                  <AdminSubmitButton
                    className="admin-action"
                    pendingLabel="Merging..."
                    successLabel="Merged"
                  >
                    Merge into stronger story
                  </AdminSubmitButton>
                </form>
              </div>
            ))}
          </div>
        ) : null}
        <div className="story-list" style={{ marginTop: "12px" }}>
          <h3>Top 10 Homepage Stories</h3>
          <div className="meta">Most important stories to review first.</div>
          {topPrimaryStories.length > 0 ? (
            topPrimaryStories.map((story) => renderStoryEditorCard(story))
          ) : (
            <div className="story">
              <div className="meta">No stories currently ranked in the top 10.</div>
            </div>
          )}
        </div>

        <div className="story-list" style={{ marginTop: "20px" }}>
          <h3>Next 10 Watchlist</h3>
          <div className="meta">Stories ranked #11-#20 that can move into the homepage top 10.</div>
          {topNextStories.length > 0 ? (
            topNextStories.map((story) => renderStoryEditorCard(story))
          ) : (
            <div className="story">
              <div className="meta">No stories currently in the #11-#20 watchlist.</div>
            </div>
          )}
        </div>

        <details style={{ marginTop: "20px" }}>
          <summary className="admin-link">All other stories ({otherStories.length})</summary>
          <div className="story-list" style={{ marginTop: "10px" }}>
            {otherStories.length > 0 ? (
              otherStories.map((story) => renderStoryEditorCard(story))
            ) : (
              <div className="story">
                <div className="meta">No additional stories available.</div>
              </div>
            )}
          </div>
        </details>
      </section>

      <datalist id="story-ids">
        {orderedStories.map((story) => (
          <option key={`story-${story.id}`} value={story.id}>
            {story.title}
          </option>
        ))}
      </datalist>
    </main>
  );
}
