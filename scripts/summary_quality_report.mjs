import pg from "pg";

const { Client } = pg;

const TOP_LIMIT = Number.parseInt(process.env.QA_STORY_LIMIT ?? "20", 10) || 20;
const SHOW_LIMIT = Number.parseInt(process.env.QA_SHOW_LIMIT ?? "10", 10) || 10;

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

const STORY_QUERY = `
  select
    s.id,
    s.title,
    s.summary,
    s.editor_title,
    s.editor_summary,
    s.status,
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
  limit 200
`;

function normalizeSummary(summary) {
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

function countHits(text, terms) {
  const lowered = text.toLowerCase();
  return terms.reduce((count, term) => (lowered.includes(term) ? count + 1 : count), 0);
}

function scoreStory(inputs) {
  const keywords = {
    impact: ["legislation", "bill", "policy", "funding", "budget", "superintendent", "district", "statewide", "board", "mandate"],
    urgency: ["emergency", "closure", "lockdown", "safety", "security", "threat", "shooting", "outbreak", "urgent"],
    novelty: ["pilot", "launch", "new", "first", "rollout", "initiative", "program", "expansion"],
    relevance: ["teacher", "students", "classroom", "curriculum", "school", "k-12", "k12", "principal", "edtech"]
  };

  const text = `${inputs.title} ${inputs.summary ?? ""}`;
  const impact = Math.min(countHits(text, keywords.impact), 3);
  const urgency = Math.min(countHits(text, keywords.urgency), 3);
  const novelty = Math.min(countHits(text, keywords.novelty), 3);
  const relevance = Math.min(countHits(text, keywords.relevance), 3);

  const volume = Math.log1p(inputs.articleCount);
  const hoursSince = (Date.now() - inputs.latestAt.getTime()) / (1000 * 60 * 60);
  const recencyBoost = 0.6 + 0.4 * Math.exp(-hoursSince / 48);

  const base = impact * 2.0 + urgency * 1.5 + novelty * 1.2 + relevance * 1.0 + volume * 0.8;
  return Number((base * inputs.avgWeight * recencyBoost).toFixed(2));
}

function summaryDedupTokens(summary) {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !SUMMARY_DEDUPE_STOPWORDS.has(token));
}

function summaryOverlapRatio(a, b) {
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

function summariesAreNearDuplicate(a, b) {
  const normalizedA = a.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedB = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalizedA === normalizedB) return true;
  return summaryOverlapRatio(normalizedA, normalizedB) >= 0.82;
}

function dedupeStorySummariesForDisplay(stories) {
  const seen = [];

  return stories.map((story) => {
    const editorCandidate = normalizeSummary(story.editor_summary);
    const storyCandidate = normalizeSummary(story.summary);
    const candidates = [editorCandidate, storyCandidate].filter(
      (candidate, index, all) => Boolean(candidate) && all.indexOf(candidate) === index
    );

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

function summaryOpening(summary) {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
}

function truncate(text, maxLength = 170) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add it to .env before running qa:summaries.");
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const rows = (await client.query(STORY_QUERY)).rows;
    const methodStats = (
      await client.query(`
        select summary_choice_method as method, count(*)::int as count
        from articles
        where fetched_at >= now() - interval '24 hours'
        group by summary_choice_method
        order by count desc
      `)
    ).rows;

    const scored = rows
      .filter((row) => row.status !== "hidden")
      .filter((row) => {
        const title = String(row.editor_title ?? row.title ?? "").trim();
        if (!title) return false;
        if (/^from\s+/i.test(title)) return false;
        if (/^(news|opinion|podcast|video)\s*\|/i.test(title)) return false;
        return true;
      })
      .map((row) => {
        const editorSummary = normalizeSummary(row.editor_summary);
        const storySummary = normalizeSummary(row.summary);
        const latestArticleSummary = normalizeSummary(row.latest_summary);
        const resolvedSummary = editorSummary ?? storySummary ?? latestArticleSummary;

        return {
          ...row,
          summary: storySummary ?? latestArticleSummary,
          editor_summary: editorSummary,
          article_count: Number(row.article_count),
          score: scoreStory({
            title: row.editor_title ?? row.title,
            summary: resolvedSummary,
            articleCount: Number(row.article_count),
            avgWeight: Number(row.avg_weight),
            latestAt: new Date(row.latest_at)
          })
        };
      });

    const pinned = scored.filter((story) => story.status === "pinned");
    const rest = scored.filter((story) => story.status !== "pinned");
    const ranked = [
      ...pinned.sort((a, b) => b.score - a.score),
      ...rest.sort((a, b) => b.score - a.score)
    ].slice(0, TOP_LIMIT);

    const displayRows = dedupeStorySummariesForDisplay(ranked);
    const summaries = displayRows
      .map((story) => story.editor_summary ?? story.summary)
      .filter(Boolean);

    let duplicatePairs = 0;
    for (let i = 0; i < summaries.length; i += 1) {
      for (let j = i + 1; j < summaries.length; j += 1) {
        if (summariesAreNearDuplicate(summaries[i], summaries[j])) duplicatePairs += 1;
      }
    }

    const openingGroups = new Map();
    for (const summary of summaries) {
      const opening = summaryOpening(summary);
      if (!opening) continue;
      const count = openingGroups.get(opening) ?? 0;
      openingGroups.set(opening, count + 1);
    }

    const repeatedOpenings = [...openingGroups.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);

    const syntheticShown = summaries.filter((summary) =>
      DISPLAY_SYNTHETIC_FALLBACK_PATTERNS.some((pattern) => pattern.test(summary))
    ).length;
    const blankShown = displayRows.filter((story) => !(story.editor_summary ?? story.summary)).length;

    console.log(`Simulated homepage set: ${displayRows.length} stories (top limit ${TOP_LIMIT})`);
    console.log(`- Blank previews after filters/dedupe: ${blankShown}`);
    console.log(`- Synthetic fallback previews shown: ${syntheticShown}`);
    console.log(`- Near-duplicate preview pairs: ${duplicatePairs}`);

    if (repeatedOpenings.length > 0) {
      console.log("- Repeated preview openings:");
      for (const [opening, count] of repeatedOpenings.slice(0, 5)) {
        console.log(`  ${count}x: "${opening}"`);
      }
    }

    if (methodStats.length > 0) {
      const methods = methodStats.map((row) => `${row.method}:${row.count}`).join(", ");
      console.log(`- Article summary_choice_method (last 24h): ${methods}`);
    }

    console.log("");
    console.log(`Top ${Math.min(SHOW_LIMIT, displayRows.length)} previews:`);
    displayRows.slice(0, SHOW_LIMIT).forEach((story, index) => {
      const title = String(story.editor_title ?? story.title ?? "").trim();
      const preview = story.editor_summary ?? story.summary ?? "[no preview]";
      console.log(`${index + 1}. ${title}`);
      console.log(`   ${truncate(preview)}`);
    });
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
