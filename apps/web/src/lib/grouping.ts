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

const TOKEN_CANONICAL: Record<string, string> = {
  sue: "lawsuit",
  sues: "lawsuit",
  sued: "lawsuit",
  suing: "lawsuit",
  lawsuit: "lawsuit",
  lawsuits: "lawsuit",
  filed: "lawsuit",
  filing: "lawsuit",
  challenge: "lawsuit",
  challenges: "lawsuit",
  challenged: "lawsuit",
  close: "closure",
  closes: "closure",
  closed: "closure",
  closing: "closure",
  closure: "closure",
  closures: "closure",
  vote: "vote",
  votes: "vote",
  voted: "vote",
  voting: "vote",
  approve: "vote",
  approves: "vote",
  approved: "vote",
  raid: "raid",
  raids: "raid",
  raided: "raid",
  warrant: "raid",
  warrants: "raid",
  probe: "investigation",
  probes: "investigation",
  investigated: "investigation",
  investigation: "investigation",
  investigations: "investigation"
};

const EVENT_ACTION_TOKENS = new Set([
  "lawsuit",
  "closure",
  "vote",
  "raid",
  "investigation",
  "strike",
  "ban",
  "funding",
  "budget",
  "layoff",
  "leave"
]);

const GENERIC_CONTEXT_TOKENS = new Set([
  "school",
  "district",
  "student",
  "teacher",
  "parent",
  "public",
  "charter",
  "education",
  "policy",
  "state",
  "board",
  "law",
  "bill",
  "legislation",
  "program",
  "plan",
  "system",
  "official"
]);

const MERGE_EVENT_CLUSTER_THRESHOLD = 0.3;
const SPLIT_DOMINANCE_RATIO_THRESHOLD = 0.67;

const STATE_GEO_ALIASES: Record<string, string[]> = {
  alabama: ["alabama"],
  alaska: ["alaska"],
  arizona: ["arizona", "phoenix"],
  arkansas: ["arkansas"],
  california: ["california", "los angeles", "lausd", "oakland", "sacramento", "san diego", "san francisco"],
  colorado: ["colorado", "denver"],
  connecticut: ["connecticut"],
  delaware: ["delaware"],
  florida: ["florida", "miami", "orlando", "tampa"],
  georgia: ["georgia", "atlanta"],
  hawaii: ["hawaii"],
  idaho: ["idaho"],
  illinois: ["illinois", "chicago", "cps"],
  indiana: ["indiana", "indianapolis", "indy"],
  iowa: ["iowa"],
  kansas: ["kansas"],
  kentucky: ["kentucky"],
  louisiana: ["louisiana", "new orleans"],
  maine: ["maine"],
  maryland: ["maryland", "baltimore"],
  massachusetts: ["massachusetts", "boston"],
  michigan: ["michigan", "detroit"],
  minnesota: ["minnesota", "minneapolis", "st paul"],
  mississippi: ["mississippi"],
  missouri: ["missouri", "st louis", "kansas city"],
  montana: ["montana"],
  nebraska: ["nebraska"],
  nevada: ["nevada", "las vegas"],
  "new hampshire": ["new hampshire"],
  "new jersey": ["new jersey", "newark"],
  "new mexico": ["new mexico"],
  "new york": ["new york", "new york city", "nyc", "brooklyn", "bronx", "queens"],
  "north carolina": ["north carolina", "charlotte", "raleigh"],
  "north dakota": ["north dakota"],
  ohio: ["ohio", "columbus", "cleveland", "cincinnati"],
  oklahoma: ["oklahoma"],
  oregon: ["oregon", "portland"],
  pennsylvania: ["pennsylvania", "philadelphia", "philly", "pittsburgh"],
  "rhode island": ["rhode island"],
  "south carolina": ["south carolina"],
  "south dakota": ["south dakota"],
  tennessee: ["tennessee", "memphis", "nashville"],
  texas: ["texas", "houston", "dallas", "austin", "san antonio"],
  utah: ["utah"],
  vermont: ["vermont"],
  virginia: ["virginia", "richmond"],
  washington: ["washington state", "seattle"],
  "west virginia": ["west virginia"],
  wisconsin: ["wisconsin", "milwaukee"],
  wyoming: ["wyoming"],
  "district of columbia": ["district of columbia", "washington dc", "washington d c", "dc"]
};

const STATE_GEO_ALIAS_INDEX = Object.entries(STATE_GEO_ALIASES).map(([state, aliases]) => ({
  state,
  aliases: aliases.map((alias) => normalizeGeoText(alias).trim())
}));

const ENTITY_TOKEN_STOPWORDS = new Set([
  "school",
  "schools",
  "district",
  "districts",
  "student",
  "students",
  "teacher",
  "teachers",
  "state",
  "states",
  "board",
  "boards",
  "education",
  "public",
  "official",
  "officials",
  "families",
  "parents",
  "parent",
  "lawsuit",
  "investigation",
  "closure",
  "vote",
  "funding",
  "budget",
  "policy",
  "bill",
  "bills",
  "house",
  "senate",
  "legislature",
  "legislative",
  "session",
  "news",
  "report",
  "reports",
  "amid",
  "after",
  "before",
  "over",
  "new",
  "latest"
]);

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

type SplitCandidateStory = {
  id: string;
  story_key: string | null;
  title: string;
  last_seen_at: string;
  article_count: number;
};

type SplitStoryArticle = {
  article_id: string;
  title: string | null;
  summary: string | null;
  url: string;
  timestamp: string | null;
  is_primary: boolean;
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

export type SplitMixedStoriesOptions = {
  lookbackDays?: number;
  candidateLimit?: number;
  maxSplits?: number;
  dryRun?: boolean;
};

export type SplitMixedStoriesResult = {
  candidates: number;
  flagged: number;
  split: number;
};

type MergeOverlapDetails = {
  ratio: number;
  sharedTokens: number;
  sharedActionTokens: number;
  sharedStrongTokens: number;
};

type StoryStateCache = Map<string, string | null>;
type StoryEntityTokenCache = Map<string, Set<string>>;

type Queryable = {
  query: (queryText: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGeoText(text: string) {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function inferStateFromText(text: string) {
  const normalized = normalizeGeoText(text);
  if (normalized.trim().length === 0) return null;

  for (const entry of STATE_GEO_ALIAS_INDEX) {
    for (const alias of entry.aliases) {
      if (alias.length < 2) continue;
      if (normalized.includes(` ${alias} `)) {
        return entry.state;
      }
    }
  }

  return null;
}

function inferStoryState(story: Pick<MergeCandidateStory, "id" | "title" | "story_key">, cache: StoryStateCache) {
  const cached = cache.get(story.id);
  if (cached !== undefined) return cached;

  const storyText = `${String(story.title ?? "")} ${String(story.story_key ?? "").replace(/-/g, " ")}`.trim();
  const state = inferStateFromText(storyText);
  cache.set(story.id, state);
  return state;
}

function getStoryEntityTokens(story: MergeCandidateStory, cache: StoryEntityTokenCache) {
  const cached = cache.get(story.id);
  if (cached) return cached;

  const rawWords = String(story.title ?? "")
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);

  const tokens = new Set<string>();
  rawWords.forEach((rawWord, index) => {
    const isAllCaps = /^[A-Z0-9]{2,}$/.test(rawWord);
    const isCapitalized = /^[A-Z][a-z]+$/.test(rawWord);
    if (!isAllCaps && !(index > 0 && isCapitalized)) return;

    const normalized = canonicalizeMergeToken(rawWord);
    if (!normalized || normalized.length < 3) return;
    if (STOPWORDS.has(normalized)) return;
    if (GENERIC_CONTEXT_TOKENS.has(normalized)) return;
    if (EVENT_ACTION_TOKENS.has(normalized)) return;
    if (ENTITY_TOKEN_STOPWORDS.has(normalized)) return;

    tokens.add(normalized);
  });

  cache.set(story.id, tokens);
  return tokens;
}

function countSharedTokens(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared;
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

function canonicalizeMergeToken(token: string) {
  const raw = token.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!raw) return "";

  const direct = TOKEN_CANONICAL[raw];
  if (direct) return direct;

  const normalized = normalizeMergeToken(raw);
  return TOKEN_CANONICAL[normalized] ?? normalized;
}

function storyMergeTokens(story: MergeCandidateStory) {
  const expandTokens = (tokens: string[]) => {
    const out: string[] = [];
    for (const token of tokens) {
      const normalized = canonicalizeMergeToken(token);
      if (normalized.length >= 3 && !STOPWORDS.has(normalized)) {
        out.push(normalized);
      }
      const aliases = TOKEN_ALIASES[normalized] ?? [];
      for (const alias of aliases) {
        const aliasNormalized = canonicalizeMergeToken(alias);
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

function mergeOverlapDetails(a: MergeCandidateStory, b: MergeCandidateStory, cache: Map<string, string[]>): MergeOverlapDetails {
  const getTokens = (story: MergeCandidateStory) => {
    const cached = cache.get(story.id);
    if (cached) return cached;
    const tokens = storyMergeTokens(story);
    cache.set(story.id, tokens);
    return tokens;
  };

  const tokensA = getTokens(a);
  const tokensB = getTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) {
    return { ratio: 0, sharedTokens: 0, sharedActionTokens: 0, sharedStrongTokens: 0 };
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let sharedTokens = 0;
  let sharedActionTokens = 0;
  let sharedStrongTokens = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      sharedTokens += 1;
      if (EVENT_ACTION_TOKENS.has(token)) sharedActionTokens += 1;
      if (!EVENT_ACTION_TOKENS.has(token) && !GENERIC_CONTEXT_TOKENS.has(token)) {
        sharedStrongTokens += 1;
      }
    }
  }

  return {
    ratio: sharedTokens / Math.max(1, Math.min(setA.size, setB.size)),
    sharedTokens,
    sharedActionTokens,
    sharedStrongTokens
  };
}

function shouldMergeStories(
  a: MergeCandidateStory,
  b: MergeCandidateStory,
  details: MergeOverlapDetails,
  similarityThreshold: number,
  stateCache: StoryStateCache,
  entityTokenCache: StoryEntityTokenCache
) {
  const stateA = inferStoryState(a, stateCache);
  const stateB = inferStoryState(b, stateCache);
  if (stateA && stateB && stateA !== stateB) {
    return false;
  }

  const entityA = getStoryEntityTokens(a, entityTokenCache);
  const entityB = getStoryEntityTokens(b, entityTokenCache);
  const sharedEntityTokens = countSharedTokens(entityA, entityB);
  if (
    entityA.size >= 2 &&
    entityB.size >= 2 &&
    sharedEntityTokens === 0 &&
    details.sharedStrongTokens === 0 &&
    details.sharedActionTokens >= 1
  ) {
    return false;
  }

  if (details.ratio >= similarityThreshold) {
    return details.sharedStrongTokens >= 1 || details.sharedActionTokens >= 2;
  }
  return (
    details.ratio >= MERGE_EVENT_CLUSTER_THRESHOLD &&
    details.sharedTokens >= 3 &&
    details.sharedActionTokens >= 1 &&
    details.sharedStrongTokens >= 1
  );
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

async function findStoryByKeyExcluding(storyKey: string, excludedStoryId: string, lookbackDays = 14) {
  const result = await pool.query(
    `select id from stories
     where story_key = $1
       and id <> $2
       and coalesce(status, 'active') <> 'hidden'
       and last_seen_at >= now() - make_interval(days => $3::int)
     order by last_seen_at desc
     limit 1`,
    [storyKey, excludedStoryId, lookbackDays]
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
  const similarityThreshold = Math.min(0.95, Math.max(0.3, options.similarityThreshold ?? 0.56));
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
  const stateCache: StoryStateCache = new Map();
  const entityTokenCache: StoryEntityTokenCache = new Map();
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
      const overlap = mergeOverlapDetails(a, b, tokenCache);
      if (!shouldMergeStories(a, b, overlap, similarityThreshold, stateCache, entityTokenCache)) continue;

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

type DominantStateDecision = {
  state: string;
  dominantCount: number;
  source: "story" | "majority";
};

function resolveDominantState(
  story: SplitCandidateStory,
  articleStates: Array<{ state: string | null }>,
  stateCache: StoryStateCache
): DominantStateDecision | null {
  const counts = new Map<string, number>();
  for (const entry of articleStates) {
    if (!entry.state) continue;
    counts.set(entry.state, (counts.get(entry.state) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  const storyState = inferStoryState(story, stateCache);
  if (storyState) {
    const storyStateCount = counts.get(storyState) ?? 0;
    if (storyStateCount >= 1) {
      return {
        state: storyState,
        dominantCount: storyStateCount,
        source: "story"
      };
    }
  }

  let topState: string | null = null;
  let topCount = 0;
  let runnerUpCount = 0;
  for (const [state, count] of counts.entries()) {
    if (count > topCount) {
      runnerUpCount = topCount;
      topCount = count;
      topState = state;
    } else if (count > runnerUpCount) {
      runnerUpCount = count;
    }
  }

  if (!topState || topCount < 2 || topCount <= runnerUpCount) return null;
  if (topCount / articleStates.length < SPLIT_DOMINANCE_RATIO_THRESHOLD) return null;

  return {
    state: topState,
    dominantCount: topCount,
    source: "majority"
  };
}

async function ensureStoryHasPrimary(queryable: Queryable, storyId: string) {
  await queryable.query(
    `with has_primary as (
       select 1
       from story_articles
       where story_id = $1
         and is_primary
       limit 1
     ),
     fallback as (
       select sa.article_id
       from story_articles sa
       join articles a on a.id = sa.article_id
       where sa.story_id = $1
       order by coalesce(a.published_at, a.fetched_at) desc
       limit 1
     )
     update story_articles sa
     set is_primary = true
     from fallback
     where sa.story_id = $1
       and sa.article_id = fallback.article_id
       and not exists (select 1 from has_primary)`,
    [storyId]
  );
}

async function refreshStoryLastSeen(queryable: Queryable, storyId: string) {
  await queryable.query(
    `update stories
     set last_seen_at = coalesce(
           (
             select max(coalesce(a.published_at, a.fetched_at))
             from story_articles sa
             join articles a on a.id = sa.article_id
             where sa.story_id = $1
           ),
           last_seen_at
         ),
         updated_at = now()
     where id = $1`,
    [storyId]
  );
}

async function moveOutlierArticle(
  sourceStoryId: string,
  article: SplitStoryArticle,
  lookbackDays: number
) {
  const title = String(article.title ?? "").trim();
  if (!title) return false;

  const storyKey = createStoryKey(title);
  if (!storyKey) return false;

  const timestampValue = article.timestamp ? new Date(article.timestamp) : new Date();
  const timestamp = Number.isNaN(timestampValue.getTime()) ? new Date() : timestampValue;
  let targetStoryId = await findStoryByKeyExcluding(storyKey, sourceStoryId, Math.max(lookbackDays, 14));
  let targetCreated = false;
  try {
    if (!targetStoryId) {
      const created = await pool.query(
        `insert into stories (story_key, title, summary, first_seen_at, last_seen_at)
         values ($1, $2, $3, $4, $4)
         returning id`,
        [storyKey, title, article.summary ?? null, timestamp]
      );
      targetStoryId = created.rows[0]?.id as string | undefined;
      targetCreated = Boolean(targetStoryId);
    }

    if (!targetStoryId) {
      throw new Error("failed_to_resolve_target_story");
    }

    const sourceLink = await pool.query(
      `select article_id
       from story_articles
       where story_id = $1
         and article_id = $2
       limit 1`,
      [sourceStoryId, article.article_id]
    );
    if (sourceLink.rows.length === 0) {
      return false;
    }

    const alreadyOnTarget = await pool.query(
      `select article_id
       from story_articles
       where story_id = $1
         and article_id = $2
       limit 1`,
      [targetStoryId, article.article_id]
    );

    if (alreadyOnTarget.rows.length > 0) {
      await pool.query(
        `delete from story_articles
         where story_id = $1
           and article_id = $2`,
        [sourceStoryId, article.article_id]
      );
    } else {
      const moved = await pool.query(
        `update story_articles
         set story_id = $1,
             is_primary = $4
         where story_id = $2
           and article_id = $3
         returning article_id`,
        [targetStoryId, sourceStoryId, article.article_id, targetCreated]
      );
      if (moved.rows.length !== 1) {
        throw new Error(`expected_1_row_moved_got_${moved.rows.length}`);
      }
    }

    await pool.query(
      `update stories
       set last_seen_at = greatest(last_seen_at, $2),
           updated_at = now()
       where id = $1`,
      [targetStoryId, timestamp]
    );
    await ensureStoryHasPrimary(pool, targetStoryId);

    const sourceCount = await pool.query(
      `select count(*)::int as count
       from story_articles
       where story_id = $1`,
      [sourceStoryId]
    );
    const remaining = Number(sourceCount.rows[0]?.count ?? 0);
    if (remaining === 0) {
      await pool.query(`delete from stories where id = $1`, [sourceStoryId]);
    } else {
      await refreshStoryLastSeen(pool, sourceStoryId);
      await ensureStoryHasPrimary(pool, sourceStoryId);
    }

    return true;
  } catch {
    return false;
  }
}

export async function splitMixedStories(
  options: SplitMixedStoriesOptions = {}
): Promise<SplitMixedStoriesResult> {
  const lookbackDays = Math.max(1, Math.floor(options.lookbackDays ?? 5));
  const candidateLimit = Math.max(20, Math.floor(options.candidateLimit ?? 200));
  const maxSplits = Math.max(0, Math.floor(options.maxSplits ?? 20));
  const dryRun = Boolean(options.dryRun);

  if (maxSplits === 0) {
    return { candidates: 0, flagged: 0, split: 0 };
  }

  const storiesResult = await pool.query(
    `select
       s.id,
       s.story_key,
       coalesce(s.editor_title, s.title) as title,
       s.last_seen_at,
       count(sa.article_id)::int as article_count
     from stories s
     join story_articles sa on sa.story_id = s.id
     join articles a on a.id = sa.article_id
     where coalesce(s.status, 'active') <> 'hidden'
       and s.last_seen_at >= now() - make_interval(days => $1::int)
       and coalesce(a.quality_label, 'unknown') <> 'non_article'
     group by s.id
     having count(sa.article_id) >= 2
     order by s.last_seen_at desc
     limit $2`,
    [lookbackDays, candidateLimit]
  );

  const candidates = storiesResult.rows as SplitCandidateStory[];
  const stateCache: StoryStateCache = new Map();
  let flagged = 0;
  let split = 0;

  for (const story of candidates) {
    if (!story) continue;
    if (!dryRun && split >= maxSplits) break;

    const articleResult = await pool.query<SplitStoryArticle>(
      `select
         sa.article_id,
         sa.is_primary,
         a.title,
         a.summary,
         a.url,
         coalesce(a.published_at, a.fetched_at) as timestamp
       from story_articles sa
       join articles a on a.id = sa.article_id
       where sa.story_id = $1
         and coalesce(a.quality_label, 'unknown') <> 'non_article'
       order by coalesce(a.published_at, a.fetched_at) desc`,
      [story.id]
    );

    const articles = articleResult.rows;
    if (articles.length < 2) continue;

    const articleStates = articles.map((article) => ({
      article,
      state: inferStateFromText(`${String(article.title ?? "")} ${article.url}`)
    }));
    const dominantState = resolveDominantState(
      story,
      articleStates.map((entry) => ({ state: entry.state })),
      stateCache
    );
    if (!dominantState) continue;
    if (dominantState.dominantCount < 1) continue;

    const outliers = articleStates.filter((entry) => entry.state && entry.state !== dominantState.state);
    if (outliers.length === 0) continue;

    flagged += outliers.length;

    if (dryRun) continue;
    const toMove = outliers[0]?.article;
    if (!toMove) continue;

    const moved = await moveOutlierArticle(story.id, toMove, lookbackDays);
    if (moved) {
      split += 1;
    }
  }

  return {
    candidates: candidates.length,
    flagged,
    split
  };
}
