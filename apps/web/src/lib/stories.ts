import "server-only";
import { pool } from "./db";
import { scoreStory, storyMatchesAudience, type Audience } from "./ranking";

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
  /^(new coverage highlights|recent reporting points to|new reporting points to|districts are now tracking)\b/i,
  /^(budget coverage now centers on|new (finance|budget) reporting highlights|district budget attention is shifting toward)\b/i,
  /^(policy coverage is focused on|legal and policy reporting now centers on|new governance reporting highlights)\b/i,
  /^(education reporting is focused on|classroom-focused coverage now highlights|new school reporting points to)\b/i
];

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

  if (!cleaned) return null;

  const lowered = cleaned.toLowerCase();
  if (DISPLAY_SUMMARY_DISCARD_TERMS.some((term) => lowered.includes(term))) {
    return null;
  }
  if (DISPLAY_SYNTHETIC_FALLBACK_PATTERNS.some((pattern) => pattern.test(cleaned))) {
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

export async function getTopStories(limit = 20, audience?: Audience): Promise<StoryRow[]> {
  const result = await pool.query(
    `select
      s.id,
      s.title,
      s.summary,
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
      return true;
    })
    .map((row) => {
    const editorSummary = normalizeSummary(row.editor_summary as string | null | undefined);
    const storySummary = normalizeSummary(row.summary as string | null | undefined);
    const latestArticleSummary = normalizeSummary(row.latest_summary as string | null | undefined);
    const resolvedSummary = editorSummary ?? storySummary ?? latestArticleSummary;
    const text = `${row.editor_title ?? row.title} ${resolvedSummary ?? ""}`;
    const score = scoreStory({
      title: row.editor_title ?? row.title,
      summary: resolvedSummary,
      articleCount: Number(row.article_count),
      avgWeight: Number(row.avg_weight),
      latestAt: new Date(row.latest_at)
    });

    return {
      ...row,
      title: normalizeTitleCase(row.title ?? ""),
      summary: storySummary ?? latestArticleSummary,
      editor_summary: editorSummary,
      article_count: Number(row.article_count),
      source_count: Number(row.source_count),
      recent_count: Number(row.recent_count),
      avg_weight: Number(row.avg_weight),
      score,
      matches_audience: audience ? storyMatchesAudience(text, audience) : true
    };
  });

  const filtered = audience ? scored.filter((story) => story.matches_audience) : scored;
  const finalSet = filtered.length > 0 ? filtered : scored;

  const pinned = finalSet.filter((story) => story.status === "pinned");
  const rest = finalSet.filter((story) => story.status !== "pinned");

  const ranked = [
    ...pinned.sort((a, b) => b.score - a.score),
    ...rest.sort((a, b) => b.score - a.score)
  ].slice(0, limit);

  return dedupeStorySummariesForDisplay(ranked);
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
