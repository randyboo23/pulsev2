import "server-only";
import { pool } from "./db";
import {
  analyzeStoryRanking,
  storyMatchesAudience,
  type Audience,
  type StoryType
} from "./ranking";

function normalizeTitleCase(title: string) {
  const trimmed = title.trim();
  if (!trimmed) return trimmed;
  if (/[A-Z]/.test(trimmed)) return trimmed;

  const lowerExceptions = new Set([
    "a",
    "an",
    "the",
    "and",
    "but",
    "or",
    "for",
    "nor",
    "on",
    "at",
    "to",
    "from",
    "by",
    "of",
    "in",
    "vs",
    "vs.",
    "with",
    "without",
    "into",
    "over",
    "under",
    "as",
    "per"
  ]);

  const acronyms: Record<string, string> = {
    ai: "AI",
    us: "US",
    "u.s.": "U.S.",
    "k-12": "K-12",
    nyc: "NYC",
    la: "LA",
    sf: "SF",
    dc: "DC",
    stem: "STEM",
    sel: "SEL",
    cte: "CTE",
    ell: "ELL",
    esl: "ESL",
    iep: "IEP",
    edtech: "EdTech"
  };

  const titleCaseWord = (word: string, index: number) => {
    const leadingMatch = word.match(/^\W+/);
    const trailingMatch = word.match(/\W+$/);
    const leading = leadingMatch ? leadingMatch[0] : "";
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const core = word.slice(leading.length, word.length - trailing.length);
    if (!core) return word;

    const parts = core.split("-");
    const rebuilt = parts
      .map((part, partIndex) => {
        const lower = part.toLowerCase();
        if (acronyms[lower]) return acronyms[lower];
        if (index > 0 && lowerExceptions.has(lower)) return lower;
        if (/^\d/.test(lower)) return lower.toUpperCase();
        if (partIndex > 0 && lowerExceptions.has(lower)) return lower;
        if (lower.length <= 2) return lower.toUpperCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join("-");

    return `${leading}${rebuilt}${trailing}`;
  };

  return trimmed
    .split(/\s+/)
    .map((word, index) => titleCaseWord(word, index))
    .join(" ");
}

const DISPLAY_SUMMARY_DISCARD_TERMS = [
  "sign up",
  "subscribe",
  "newsletter",
  "republish",
  "sponsor",
  "advertis",
  "getty images",
  "base64-image-removed"
];

const DISPLAY_SYNTHETIC_FALLBACK_PATTERNS = [
  /^(coverage|reporting)\s+(?:is\s+)?(?:converging on|focused on|centered on|now centers on)\b/i,
  /^(new coverage highlights|recent reporting points to|new reporting points to|districts are now tracking)\b/i,
  /^(budget coverage now centers on|new (finance|budget) reporting highlights|district budget attention is shifting toward)\b/i,
  /^(policy coverage is focused on|legal and policy reporting now centers on|new governance reporting highlights)\b/i,
  /^(education reporting is focused on|classroom-focused coverage now highlights|new school reporting points to)\b/i
];

const DISPLAY_GENERIC_WHY_IT_MATTERS_PATTERNS = [
  /\bwhy it matters:\s*(district leaders and educators may need to adjust policy,\s*staffing,\s*or classroom practice\.?|school systems may need to revisit planning,\s*staffing,\s*or implementation decisions\.?|this could influence district priorities and how schools execute day-to-day operations\.?)$/i
];

const REJECT_TITLE_PATTERNS = [
  /\bslug\s*permalinkurl\b/i,
  /\bcharacters?\s+or\s+less\b/i,
  /^untitled$/i
];

const TRAILING_BOILERPLATE_PATTERNS = [
  /\bthe post\b[\s\S]{0,240}?\bappeared first on\b[\s\S]*$/i,
  /\bthis article (?:was )?originally (?:appeared|published) on\b[\s\S]*$/i,
  /\boriginally published (?:on|at)\b[\s\S]*$/i
];

const MIN_PREVIEW_CONFIDENCE = Number(process.env.PREVIEW_MIN_CONFIDENCE ?? "0.58");

function clamp(value: number, min: number, max: number) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeSummary(summary: string | null | undefined) {
  if (!summary) return null;

  let cleaned = summary
    .replace(/!\[[^\]]*\]\((?:<)?[^)\s>]+(?:>)?\)/gi, " ")
    .replace(/\[([^\]]+)\]\((?:<)?[^)\s>]+(?:>)?\)/gi, "$1")
    .replace(/<base64-image-removed>/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const pattern of TRAILING_BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ").trim();
  }

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const lowered = cleaned.toLowerCase();
  if (DISPLAY_SUMMARY_DISCARD_TERMS.some((term) => lowered.includes(term))) {
    return null;
  }
  if (DISPLAY_SYNTHETIC_FALLBACK_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return null;
  }
  if (DISPLAY_GENERIC_WHY_IT_MATTERS_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return null;
  }
  if (/(?:\bcontact\b.*){2,}/i.test(cleaned)) return null;
  if (/(?:\bdownloads?\b.*){2,}/i.test(cleaned)) return null;
  if (/(?:\bshare\b.*){3,}/i.test(cleaned)) return null;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 8) return null;

  const normalizedWords = words
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  if (normalizedWords.length >= 16) {
    const uniqueRatio = new Set(normalizedWords).size / normalizedWords.length;
    if (uniqueRatio < 0.55) return null;
  }

  if (cleaned.length > 320) cleaned = `${cleaned.slice(0, 320).trim()}…`;
  return cleaned;
}

export type StoryRow = {
  id: string;
  title: string;
  summary: string | null;
  preview_text?: string | null;
  preview_type?: "full" | "excerpt" | "headline_only" | "synthetic" | null;
  preview_confidence?: number | null;
  preview_reason?: string | null;
  editor_title?: string | null;
  editor_summary?: string | null;
  status?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  article_count: number;
  source_count: number;
  recent_count: number;
  avg_weight: number;
  latest_at: string;
  score: number;
  story_type?: StoryType;
  lead_eligible?: boolean;
  lead_reason?: string | null;
  lead_urgency_override?: boolean;
  score_breakdown?: string;
  matches_audience?: boolean;
};

export type StoryDetailRow = {
  id: string;
  title: string;
  summary: string | null;
  editor_title: string | null;
  editor_summary: string | null;
  status: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

export type StoryArticleRow = {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  published_at: string | null;
  fetched_at: string | null;
  source_name: string | null;
};

export type StoryByIdResult = {
  story: StoryDetailRow;
  articles: StoryArticleRow[];
};

const SUMMARY_DEDUPE_STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "which",
  "their",
  "there",
  "about",
  "after",
  "before",
  "under",
  "over",
  "into",
  "while",
  "where",
  "when"
]);

const TOPIC_DEDUPE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "over",
  "under",
  "after",
  "before",
  "about",
  "amid",
  "amidst",
  "will",
  "would",
  "could",
  "should",
  "what",
  "why",
  "how",
  "says",
  "say",
  "report",
  "reports",
  "latest",
  "update",
  "updates"
]);

const STORY_TOPIC_SIMILARITY_THRESHOLD = 0.62;
const STORY_TOPIC_STRONG_SIMILARITY_THRESHOLD = 0.78;
const STORY_TOPIC_SOFT_PENALTY = 0.88;
const STORY_TOPIC_STRONG_PENALTY = 0.72;

type StoryTopicCandidate = Pick<StoryRow, "id" | "title" | "editor_title">;
type StoryTopicTokenCache = Map<string, string[]>;

function normalizeTopicToken(token: string) {
  let normalized = token.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return "";
  if (normalized.endsWith("ies") && normalized.length > 4) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (normalized.endsWith("es") && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.endsWith("s") && normalized.length > 3) {
    normalized = normalized.slice(0, -1);
  }

  if (normalized.endsWith("ing") && normalized.length > 5) {
    normalized = normalized.slice(0, -3);
  } else if (normalized.endsWith("ed") && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  }

  return normalized;
}

function getStoryTopicTokens(story: StoryTopicCandidate, cache: StoryTopicTokenCache) {
  const cached = cache.get(story.id);
  if (cached) return cached;

  const title = String(story.editor_title ?? story.title ?? "").trim();
  if (!title) {
    cache.set(story.id, []);
    return [];
  }

  const tokens = title
    .split(/\s+/)
    .map((token) => normalizeTopicToken(token))
    .filter((token) => (token.length >= 3 || /^\d{2,}$/.test(token)) && !TOPIC_DEDUPE_STOPWORDS.has(token));
  const unique = Array.from(new Set(tokens)).slice(0, 14);
  cache.set(story.id, unique);
  return unique;
}

function storyTopicOverlapRatio(a: StoryTopicCandidate, b: StoryTopicCandidate, cache: StoryTopicTokenCache) {
  const tokensA = getStoryTopicTokens(a, cache);
  const tokensB = getStoryTopicTokens(b, cache);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }

  return overlap / Math.max(1, Math.min(setA.size, setB.size));
}

function maxStoryTopicOverlap(story: StoryTopicCandidate, others: StoryTopicCandidate[], cache: StoryTopicTokenCache) {
  let maxOverlap = 0;
  for (const candidate of others) {
    const overlap = storyTopicOverlapRatio(story, candidate, cache);
    if (overlap > maxOverlap) maxOverlap = overlap;
  }
  return maxOverlap;
}

function applyTopicSimilarityPenalty(stories: StoryRow[]) {
  if (stories.length <= 1) return stories;

  const cache: StoryTopicTokenCache = new Map();
  const seen: StoryRow[] = [];

  const adjusted = stories.map((story) => {
    const overlap = maxStoryTopicOverlap(story, seen, cache);
    seen.push(story);

    if (story.status === "pinned" || overlap < STORY_TOPIC_SIMILARITY_THRESHOLD) {
      return story;
    }

    const penalty = overlap >= STORY_TOPIC_STRONG_SIMILARITY_THRESHOLD
      ? STORY_TOPIC_STRONG_PENALTY
      : STORY_TOPIC_SOFT_PENALTY;

    return {
      ...story,
      score: Number((story.score * penalty).toFixed(2))
    };
  });

  const pinned = adjusted.filter((story) => story.status === "pinned");
  const rest = adjusted.filter((story) => story.status !== "pinned");
  return [...pinned.sort((a, b) => b.score - a.score), ...rest.sort((a, b) => b.score - a.score)];
}

function selectDiverseTopStories(stories: StoryRow[], limit: number) {
  const boundedLimit = Math.max(1, limit);
  if (stories.length <= boundedLimit) return stories.slice(0, boundedLimit);

  const selected: StoryRow[] = [];
  const selectedIds = new Set<string>();
  const cache: StoryTopicTokenCache = new Map();

  const pinned = stories.filter((story) => story.status === "pinned").sort((a, b) => b.score - a.score);
  for (const story of pinned) {
    if (selected.length >= boundedLimit) break;
    selected.push(story);
    selectedIds.add(story.id);
  }

  const pool = stories.filter((story) => !selectedIds.has(story.id));

  for (const story of pool) {
    if (selected.length >= boundedLimit) break;
    const overlap = maxStoryTopicOverlap(story, selected, cache);
    if (overlap >= STORY_TOPIC_SIMILARITY_THRESHOLD) continue;
    selected.push(story);
    selectedIds.add(story.id);
  }

  for (const story of pool) {
    if (selected.length >= boundedLimit) break;
    if (selectedIds.has(story.id)) continue;
    selected.push(story);
    selectedIds.add(story.id);
  }

  return selected;
}

function summaryDedupTokens(summary: string) {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !SUMMARY_DEDUPE_STOPWORDS.has(token));
}

function summaryOverlapRatio(a: string, b: string) {
  const tokensA = summaryDedupTokens(a);
  const tokensB = summaryDedupTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }

  return overlap / Math.max(1, Math.min(setA.size, setB.size));
}

function summariesAreNearDuplicate(a: string, b: string) {
  const normalizedA = a.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedB = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalizedA === normalizedB) return true;
  return summaryOverlapRatio(normalizedA, normalizedB) >= 0.82;
}

function dedupeStorySummariesForDisplay(stories: StoryRow[]) {
  const seen: string[] = [];

  return stories.map((story) => {
    const editorCandidate = normalizeSummary(story.editor_summary ?? null);
    const storyCandidate = normalizeSummary(story.summary ?? null);
    const candidates = [editorCandidate, storyCandidate].filter((candidate, index, all) =>
      Boolean(candidate) && all.indexOf(candidate) === index
    ) as string[];

    const chosen = candidates.find(
      (candidate) => !seen.some((existing) => summariesAreNearDuplicate(candidate, existing))
    );

    if (!chosen) {
      return {
        ...story,
        editor_summary: null,
        summary: null
      };
    }

    seen.push(chosen);
    const pickedEditor = editorCandidate === chosen ? chosen : null;
    return {
      ...story,
      editor_summary: pickedEditor,
      summary: chosen
    };
  });
}

function chooseLeadStory(stories: StoryRow[]) {
  if (stories.length <= 1) return stories;
  if (stories[0]?.status === "pinned") return stories;

  const eligibleIndex = stories.findIndex((story) => story.lead_eligible);
  if (eligibleIndex <= 0) return stories;

  const [lead] = stories.splice(eligibleIndex, 1);
  if (!lead) return stories;
  stories.unshift(lead);
  return stories;
}

/** Extract JSON from a response that may include markdown fences or preamble. */
function extractJson(raw: string): string {
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Find first { ... } or [ ... ] block
  const braceStart = raw.indexOf("{");
  const bracketStart = raw.indexOf("[");
  if (braceStart === -1 && bracketStart === -1) return raw.trim();
  const start =
    braceStart === -1 ? bracketStart : bracketStart === -1 ? braceStart : Math.min(braceStart, bracketStart);
  const openChar = raw[start];
  const closeChar = openChar === "{" ? "}" : "]";
  const lastClose = raw.lastIndexOf(closeChar);
  if (lastClose <= start) return raw.trim();
  return raw.slice(start, lastClose + 1);
}

// AI reranking cache
let aiRerankCache: { storyIds: string[]; demoted: Set<string>; timestamp: number } | null = null;
const AI_RERANK_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

async function aiRerank(
  stories: StoryRow[],
  limit: number
): Promise<StoryRow[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || stories.length < 3) return stories;

  // Check cache validity
  const now = Date.now();
  const currentIds = stories.slice(0, 30).map((s) => s.id);
  if (
    aiRerankCache &&
    now - aiRerankCache.timestamp < AI_RERANK_CACHE_TTL
  ) {
    const cachedIds = new Set(aiRerankCache.storyIds);
    const overlap = currentIds.filter((id) => cachedIds.has(id)).length;
    // Use cache if 70%+ overlap with previous top stories
    if (overlap >= Math.min(currentIds.length, aiRerankCache.storyIds.length) * 0.7) {
      const idOrder = new Map(aiRerankCache.storyIds.map((id, i) => [id, i]));
      return stories
        .filter((s) => !aiRerankCache!.demoted.has(s.id))
        .sort((a, b) => {
          const aIdx = idOrder.get(a.id) ?? 999;
          const bIdx = idOrder.get(b.id) ?? 999;
          if (aIdx === 999 && bIdx === 999) return b.score - a.score;
          return aIdx - bIdx;
        })
        .slice(0, limit);
    }
  }

  // Build prompt from top 30 stories
  const candidates = stories.slice(0, 30);
  const storyList = candidates
    .map(
      (s, i) =>
        `${i + 1}. "${s.editor_title ?? s.title}" [${s.source_count} sources, type: ${s.story_type ?? "unknown"}]${s.summary ? `\n   ${s.summary.slice(0, 120)}` : ""}`
    )
    .join("\n");

  const prompt = `You are the editorial director for a K-12 education news homepage serving superintendents, principals, and district administrators.

Below are ${candidates.length} stories ranked by a deterministic algorithm. Reorder them by editorial importance.

Ranking criteria (in priority order):
1. Scope of impact: national > state > district > single school
2. Urgency: time-sensitive developments > ongoing coverage > background
3. Audience relevance: affects superintendent/principal decisions > general interest
4. Source authority: established reporters and outlets > blogs and personal sites
5. Novelty: new developments > updates on ongoing stories > evergreen content
6. Diversity: avoid multiple stories about the same event unless there is a clearly new development

Stories:
${storyList}

Respond with ONLY valid JSON:
{"order":[3,1,7,...],"demote":[15,22,...]}

"order" = story numbers in recommended display order (most important first). Include at most ${limit} stories.
"demote" = story numbers that should NOT appear on the homepage (irrelevant, personal blogs, commercial, too niche, or duplicative same-event repeats).`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 300,
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      console.error(`[rerank] anthropic error ${response.status}`);
      return stories.slice(0, limit);
    }

    const payload = await response.json();
    const text = payload?.content?.[0]?.text;
    if (!text) return stories.slice(0, limit);

    const parsed = JSON.parse(extractJson(text));
    const order: number[] = Array.isArray(parsed.order) ? parsed.order : [];
    const demoteNums: number[] = Array.isArray(parsed.demote) ? parsed.demote : [];

    const demotedIds = new Set(
      demoteNums
        .filter((n) => n >= 1 && n <= candidates.length)
        .map((n) => candidates[n - 1].id)
    );

    const reordered: StoryRow[] = [];
    const used = new Set<string>();

    for (const num of order) {
      if (num < 1 || num > candidates.length) continue;
      const story = candidates[num - 1];
      if (demotedIds.has(story.id) || used.has(story.id)) continue;
      reordered.push(story);
      used.add(story.id);
    }

    // Add any remaining stories not in the AI order (preserve deterministic fallback)
    for (const story of stories) {
      if (!used.has(story.id) && !demotedIds.has(story.id)) {
        reordered.push(story);
        used.add(story.id);
      }
    }

    // Update cache
    aiRerankCache = {
      storyIds: reordered.slice(0, 30).map((s) => s.id),
      demoted: demotedIds,
      timestamp: now
    };

    console.log(
      `[rerank] AI reordered ${order.length} stories, demoted ${demoteNums.length}`
    );

    return reordered.slice(0, limit);
  } catch (error) {
    console.error(
      `[rerank] failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return stories.slice(0, limit);
  }
}

export async function getTopStories(limit = 20, audience?: Audience): Promise<StoryRow[]> {
  const result = await pool.query(
    `select
      s.id,
      s.title,
      s.summary,
      s.preview_text,
      s.preview_type,
      s.preview_confidence,
      s.preview_reason,
      s.editor_title,
      s.editor_summary,
      s.status,
      s.first_seen_at,
      s.last_seen_at,
      count(sa.article_id) as article_count,
      count(distinct a.source_id) as source_count,
      count(a.id) filter (where coalesce(a.published_at, a.fetched_at) >= now() - interval '24 hours') as recent_count,
      avg(coalesce(src.weight, 1.0)) as avg_weight,
      max(coalesce(a.published_at, a.fetched_at)) as latest_at,
      max(latest.latest_summary) as latest_summary
    from stories s
    join story_articles sa on sa.story_id = s.id
    join articles a on a.id = sa.article_id
    left join sources src on src.id = a.source_id
    left join lateral (
      select a2.summary as latest_summary
      from story_articles sa2
      join articles a2 on a2.id = sa2.article_id
      where sa2.story_id = s.id
        and coalesce(a2.quality_label, 'unknown') <> 'non_article'
        and (a2.title is null or a2.title not ilike 'from %')
        and a2.url not ilike '%/profile/%'
        and a2.url not ilike '%/profiles/%'
        and a2.url not ilike '%/author/%'
        and a2.url not ilike '%/authors/%'
        and a2.url not ilike '%/about/%'
        and a2.url not ilike '%/bio/%'
        and a2.url not ilike '%/people/%'
        and a2.url not ilike '%/person/%'
        and a2.url not ilike '%/team/%'
        and a2.url not ilike '%/experts/%'
        and a2.url not ilike '%/expert/%'
        and a2.url !~* 'https?://[^/]+/[a-z]{2,24}/?$'
        and a2.summary is not null
        and length(trim(a2.summary)) > 0
      order by coalesce(a2.published_at, a2.fetched_at) desc
      limit 1
    ) latest on true
    where a.url not ilike '%/jobs/%'
      and a.url not ilike '%://jobs.%'
      and a.url not ilike '%/careers/%'
      and coalesce(a.quality_label, 'unknown') <> 'non_article'
      and (a.title is null or a.title not ilike 'from %')
      and a.url not ilike '%/profile/%'
      and a.url not ilike '%/profiles/%'
      and a.url not ilike '%/author/%'
      and a.url not ilike '%/authors/%'
      and a.url not ilike '%/about/%'
      and a.url not ilike '%/bio/%'
      and a.url not ilike '%/people/%'
      and a.url not ilike '%/person/%'
      and a.url not ilike '%/team/%'
      and a.url not ilike '%/experts/%'
      and a.url not ilike '%/expert/%'
      and a.url !~* 'https?://[^/]+/[a-z]{2,24}/?$'
    group by s.id
    order by max(coalesce(a.published_at, a.fetched_at)) desc
    limit 200`
  );

  const scored = result.rows
    .filter((row) => row.status !== "hidden")
    .filter((row) => {
      const title = String(row.editor_title ?? row.title ?? "").trim();
      if (!title) return false;
      if (/^from\s+/i.test(title)) return false;
      if (/^(news|opinion|podcast|video)\s*\|/i.test(title)) return false;
      if (REJECT_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return false;
      return true;
    })
    .map((row) => {
      const editorSummary = normalizeSummary(row.editor_summary as string | null | undefined);
      const storySummary = normalizeSummary(row.summary as string | null | undefined);
      const latestArticleSummary = normalizeSummary(row.latest_summary as string | null | undefined);
      const previewText = normalizeSummary(row.preview_text as string | null | undefined);
      const previewTypeRaw = String(row.preview_type ?? "").toLowerCase();
      const previewTypeValue =
        previewTypeRaw === "full" ||
        previewTypeRaw === "excerpt" ||
        previewTypeRaw === "headline_only" ||
        previewTypeRaw === "synthetic"
          ? previewTypeRaw
          : null;
      const previewReason = String(row.preview_reason ?? "").trim();
      const previewConfidenceRaw = Number(row.preview_confidence ?? 0);
      const previewConfidence = Number(
        clamp(Number.isFinite(previewConfidenceRaw) ? previewConfidenceRaw : 0, 0, 1).toFixed(2)
      );

      const hasStructuredPreview =
        previewTypeValue === "full" || previewTypeValue === "excerpt" || previewTypeValue === "headline_only";
      const isLegacyDefaultHeadlineOnly =
        previewTypeValue === "headline_only" &&
        !previewText &&
        previewConfidence === 0 &&
        previewReason.length === 0;
      let autoSummary: string | null = null;
      let autoPreviewType: "full" | "excerpt" | "headline_only" = "headline_only";
      let autoPreviewConfidence = previewConfidence;

      if (hasStructuredPreview && !isLegacyDefaultHeadlineOnly) {
        if (
          (previewTypeValue === "full" || previewTypeValue === "excerpt") &&
          previewText &&
          previewConfidence >= MIN_PREVIEW_CONFIDENCE
        ) {
          autoSummary = previewText;
          autoPreviewType = previewTypeValue;
        } else {
          autoSummary = null;
          autoPreviewType = "headline_only";
        }
      } else {
        autoSummary = storySummary ?? latestArticleSummary;
        autoPreviewType = autoSummary ? "excerpt" : "headline_only";
        autoPreviewConfidence = autoSummary ? 0.5 : 0;
      }

      const resolvedSummary = editorSummary ?? autoSummary;
      const text = `${row.editor_title ?? row.title} ${resolvedSummary ?? ""}`;
      const ranking = analyzeStoryRanking({
        title: row.editor_title ?? row.title,
        summary: resolvedSummary,
        articleCount: Number(row.article_count),
        sourceCount: Number(row.source_count),
        recentCount: Number(row.recent_count),
        avgWeight: Number(row.avg_weight),
        latestAt: new Date(row.latest_at)
      });
      let score = ranking.score;

      if (!editorSummary) {
        if (!autoSummary) {
          score = Number((score * 0.9).toFixed(2));
        } else if (autoPreviewConfidence < MIN_PREVIEW_CONFIDENCE + 0.08) {
          score = Number((score * 0.96).toFixed(2));
        }
      }

      return {
        ...row,
        title: normalizeTitleCase(row.title ?? ""),
        summary: autoSummary,
        preview_text: autoSummary,
        preview_type: editorSummary ? "full" : autoPreviewType,
        preview_confidence: editorSummary ? 1 : autoPreviewConfidence,
        editor_summary: editorSummary,
        article_count: Number(row.article_count),
        source_count: Number(row.source_count),
        recent_count: Number(row.recent_count),
        avg_weight: Number(row.avg_weight),
        score,
        story_type: ranking.storyType,
        lead_eligible: ranking.leadEligible,
        lead_reason: ranking.leadReason,
        lead_urgency_override: ranking.urgencyOverride,
        score_breakdown: JSON.stringify(ranking.breakdown),
        matches_audience: audience ? storyMatchesAudience(text, audience) : true
      };
    });

  const filtered = audience ? scored.filter((story) => story.matches_audience) : scored;
  const finalSet = filtered.length > 0 ? filtered : scored;

  const pinned = finalSet.filter((story) => story.status === "pinned");
  const rest = finalSet.filter((story) => story.status !== "pinned");

  const deterministicRanked = [
    ...pinned.sort((a, b) => b.score - a.score),
    ...rest.sort((a, b) => b.score - a.score)
  ];

  const diversityWeighted = applyTopicSimilarityPenalty(deterministicRanked);

  // AI reranking pass (falls back to deterministic if unavailable)
  const aiPoolLimit = Math.max(limit, 30);
  const ranked = await aiRerank(diversityWeighted, aiPoolLimit);
  const diversityFiltered = selectDiverseTopStories(ranked, limit);

  const leadAdjusted = chooseLeadStory([...diversityFiltered]);
  return dedupeStorySummariesForDisplay(leadAdjusted);
}

export async function getStoryById(id: string): Promise<StoryByIdResult | null> {
  const storyResult = await pool.query(
    `select id, title, summary, editor_title, editor_summary, status, first_seen_at, last_seen_at
     from stories
     where id = $1`,
    [id]
  );

  if (storyResult.rows.length === 0) {
    return null;
  }

  const articlesResult = await pool.query(
    `select
      a.id,
      a.title,
      a.summary,
      a.url,
      a.published_at,
      a.fetched_at,
      s.name as source_name
    from story_articles sa
    join articles a on a.id = sa.article_id
    left join sources s on s.id = a.source_id
    where sa.story_id = $1
      and coalesce(a.quality_label, 'unknown') <> 'non_article'
    order by coalesce(a.published_at, a.fetched_at) desc`,
    [id]
  );

  const storyRow = storyResult.rows[0] as StoryDetailRow;
  const articleRows = articlesResult.rows as StoryArticleRow[];

  return {
    story: {
      ...storyRow,
      summary: normalizeSummary(storyRow.summary as string | null | undefined),
      editor_summary: normalizeSummary(storyRow.editor_summary as string | null | undefined),
      title: normalizeTitleCase(storyRow.title ?? "")
    },
    articles: articleRows.map((article) => ({
      ...article,
      summary: normalizeSummary(article.summary as string | null | undefined)
    }))
  };
}
