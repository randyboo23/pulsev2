import "server-only";
import { pool } from "./db";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "for",
  "nor",
  "so",
  "yet",
  "to",
  "of",
  "in",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "into",
  "over",
  "after",
  "before",
  "about",
  "new",
  "report",
  "reports"
]);

const TOKEN_ALIASES: Record<string, string[]> = {
  lausd: ["los", "angel", "unifi", "school", "district"],
  la: ["los", "angel"],
  supe: ["superintendent"]
};

type MergeCandidateStory = {
  id: string;
  story_key: string | null;
  title: string;
  editor_title: string | null;
  editor_summary: string | null;
  status: string | null;
  last_seen_at: string;
  article_count: number;
};

export type MergeSimilarStoriesOptions = {
  lookbackDays?: number;
  candidateLimit?: number;
  maxMerges?: number;
  similarityThreshold?: number;
  dryRun?: boolean;
};

export type MergeSimilarStoriesResult = {
  candidates: number;
  evaluatedPairs: number;
  suggested: number;
  merged: number;
};

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMergeToken(token: string) {
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

function storyMergeTokens(story: MergeCandidateStory) {
  const expandTokens = (tokens: string[]) => {
    const out: string[] = [];
    for (const token of tokens) {
      const normalized = normalizeMergeToken(token);
      if (normalized.length >= 3 && !STOPWORDS.has(normalized)) {
        out.push(normalized);
      }
      const aliases = TOKEN_ALIASES[normalized] ?? [];
      for (const alias of aliases) {
        const aliasNormalized = normalizeMergeToken(alias);
        if (aliasNormalized.length >= 3 && !STOPWORDS.has(aliasNormalized)) {
          out.push(aliasNormalized);
        }
      }
    }
    return out;
  };

  const titleTokens = expandTokens(normalizeTitle(story.title).split(" "));
  const keyTokens = expandTokens((story.story_key ?? "").split("-"));
  return Array.from(new Set([...titleTokens, ...keyTokens])).slice(0, 24);
}

function mergeOverlapRatio(a: MergeCandidateStory, b: MergeCandidateStory, cache: Map<string, string[]>) {
  const getTokens = (story: MergeCandidateStory) => {
    const cached = cache.get(story.id);
    if (cached) return cached;
    const tokens = storyMergeTokens(story);
    cache.set(story.id, tokens);
    return tokens;
  };

  const tokensA = getTokens(a);
  const tokensB = getTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }

  return overlap / Math.max(1, Math.min(setA.size, setB.size));
}

function hasEditorOverrides(story: MergeCandidateStory) {
  return Boolean(story.editor_title?.trim() || story.editor_summary?.trim());
}

function isPinned(story: MergeCandidateStory) {
  return String(story.status ?? "").toLowerCase() === "pinned";
}

function pickMergeTarget(a: MergeCandidateStory, b: MergeCandidateStory) {
  if (isPinned(a) && !isPinned(b)) return { target: a, source: b };
  if (isPinned(b) && !isPinned(a)) return { target: b, source: a };

  const aHasEditor = hasEditorOverrides(a);
  const bHasEditor = hasEditorOverrides(b);
  if (aHasEditor && !bHasEditor) return { target: a, source: b };
  if (bHasEditor && !aHasEditor) return { target: b, source: a };

  if (a.article_count > b.article_count) return { target: a, source: b };
  if (b.article_count > a.article_count) return { target: b, source: a };

  const aTime = new Date(a.last_seen_at).getTime();
  const bTime = new Date(b.last_seen_at).getTime();
  if (aTime >= bTime) return { target: a, source: b };
  return { target: b, source: a };
}

export function createStoryKey(title: string) {
  const tokens = normalizeTitle(title)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));

  const unique = Array.from(new Set(tokens));
  const trimmed = unique.slice(0, 8).sort();

  return trimmed.join("-");
}

async function findStoryByKey(storyKey: string) {
  const result = await pool.query(
    `select id from stories
     where story_key = $1
       and last_seen_at >= now() - interval '7 days'
     order by last_seen_at desc
     limit 1`,
    [storyKey]
  );

  return result.rows[0]?.id as string | undefined;
}

async function createStory(params: {
  storyKey: string;
  title: string;
  summary: string | null;
  timestamp: Date;
}) {
  const result = await pool.query(
    `insert into stories (story_key, title, summary, first_seen_at, last_seen_at)
     values ($1, $2, $3, $4, $4)
     returning id`,
    [params.storyKey, params.title, params.summary, params.timestamp]
  );

  return result.rows[0].id as string;
}

async function addArticleToStory(storyId: string, articleId: string, isPrimary: boolean) {
  await pool.query(
    `insert into story_articles (story_id, article_id, is_primary)
     values ($1, $2, $3)
     on conflict (story_id, article_id) do nothing`,
    [storyId, articleId, isPrimary]
  );
}

async function updateStoryTimestamp(storyId: string, timestamp: Date) {
  await pool.query(
    `update stories
     set last_seen_at = greatest(last_seen_at, $2),
         updated_at = now()
     where id = $1`,
    [storyId, timestamp]
  );
}

export async function groupUngroupedArticles() {
  const articlesResult = await pool.query(
    `select id, title, summary, published_at, fetched_at
     from articles
     where id not in (select article_id from story_articles)
       and coalesce(quality_label, 'unknown') <> 'non_article'
     order by coalesce(published_at, fetched_at) desc
     limit 300`
  );

  let grouped = 0;

  for (const article of articlesResult.rows) {
    const title = article.title as string | null;
    if (!title) continue;

    const storyKey = createStoryKey(title);
    if (!storyKey) continue;

    const timestampValue = article.published_at ?? article.fetched_at;
    const timestamp = timestampValue ? new Date(timestampValue) : new Date();
    let storyId = await findStoryByKey(storyKey);

    let isPrimary = false;
    if (!storyId) {
      storyId = await createStory({
        storyKey,
        title,
        summary: article.summary ?? null,
        timestamp
      });
      isPrimary = true;
    }

    await addArticleToStory(storyId, article.id, isPrimary);
    await updateStoryTimestamp(storyId, timestamp);
    grouped += 1;
  }

  return grouped;
}

export async function mergeSimilarStories(options: MergeSimilarStoriesOptions = {}): Promise<MergeSimilarStoriesResult> {
  const lookbackDays = Math.max(1, Math.floor(options.lookbackDays ?? 4));
  const candidateLimit = Math.max(20, Math.floor(options.candidateLimit ?? 180));
  const maxMerges = Math.max(0, Math.floor(options.maxMerges ?? 12));
  const similarityThreshold = Math.min(0.95, Math.max(0.4, options.similarityThreshold ?? 0.62));
  const dryRun = Boolean(options.dryRun);

  if (maxMerges === 0) {
    return { candidates: 0, evaluatedPairs: 0, suggested: 0, merged: 0 };
  }

  const storiesResult = await pool.query(
    `select
       s.id,
       s.story_key,
       coalesce(s.editor_title, s.title) as title,
       s.editor_title,
       s.editor_summary,
       s.status,
       s.last_seen_at,
       count(sa.article_id)::int as article_count
     from stories s
     join story_articles sa on sa.story_id = s.id
     join articles a on a.id = sa.article_id
     where coalesce(s.status, 'active') <> 'hidden'
       and s.last_seen_at >= now() - make_interval(days => $1::int)
       and coalesce(a.quality_label, 'unknown') <> 'non_article'
     group by s.id
     order by s.last_seen_at desc
     limit $2`,
    [lookbackDays, candidateLimit]
  );

  const stories = storiesResult.rows as MergeCandidateStory[];
  const tokenCache = new Map<string, string[]>();
  const sourceUsed = new Set<string>();
  const plans: { sourceId: string; targetId: string }[] = [];
  let evaluatedPairs = 0;

  for (let i = 0; i < stories.length; i += 1) {
    const a = stories[i];
    if (!a || sourceUsed.has(a.id)) continue;

    for (let j = i + 1; j < stories.length; j += 1) {
      const b = stories[j];
      if (!b || sourceUsed.has(b.id)) continue;

      const daysApart = Math.abs(new Date(a.last_seen_at).getTime() - new Date(b.last_seen_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysApart > lookbackDays) break;

      evaluatedPairs += 1;
      const overlap = mergeOverlapRatio(a, b, tokenCache);
      if (overlap < similarityThreshold) continue;

      const { target, source } = pickMergeTarget(a, b);
      if (sourceUsed.has(source.id) || sourceUsed.has(target.id)) continue;

      plans.push({ sourceId: source.id, targetId: target.id });
      sourceUsed.add(source.id);

      const targetRef = stories.find((story) => story.id === target.id);
      const sourceRef = stories.find((story) => story.id === source.id);
      if (targetRef && sourceRef) {
        targetRef.article_count += sourceRef.article_count;
        if (new Date(sourceRef.last_seen_at) > new Date(targetRef.last_seen_at)) {
          targetRef.last_seen_at = sourceRef.last_seen_at;
        }
      }

      if (plans.length >= maxMerges) break;
    }

    if (plans.length >= maxMerges) break;
  }

  if (dryRun || plans.length === 0) {
    return {
      candidates: stories.length,
      evaluatedPairs,
      suggested: plans.length,
      merged: 0
    };
  }

  let merged = 0;
  for (const plan of plans) {
    try {
      const result = await pool.query(
        `with moved as (
           insert into story_articles (story_id, article_id, is_primary)
           select $2, article_id, false
           from story_articles
           where story_id = $1
           on conflict (story_id, article_id) do nothing
         ),
         updated as (
           update stories as target
           set last_seen_at = greatest(target.last_seen_at, source.last_seen_at),
               summary = case
                 when target.summary is null or length(trim(target.summary)) = 0 then source.summary
                 else target.summary
               end,
               editor_title = coalesce(target.editor_title, source.editor_title),
               editor_summary = coalesce(target.editor_summary, source.editor_summary),
               status = case
                 when target.status = 'pinned' or source.status = 'pinned' then 'pinned'
                 else target.status
               end,
               updated_at = now()
           from stories as source
           where source.id = $1
             and target.id = $2
         ),
         deleted_links as (
           delete from story_articles where story_id = $1
         )
         delete from stories where id = $1
         returning id as deleted_id`,
        [plan.sourceId, plan.targetId]
      );

      if (result.rows.length > 0) {
        merged += 1;
      }
    } catch {
      // Keep ingest resilient: skip failed merge plans and continue.
    }
  }

  return {
    candidates: stories.length,
    evaluatedPairs,
    suggested: plans.length,
    merged
  };
}
