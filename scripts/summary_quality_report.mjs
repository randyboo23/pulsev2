import pg from "pg";

const { Client } = pg;

const TOP_LIMIT = Number.parseInt(process.env.QA_STORY_LIMIT ?? "20", 10) || 20;
const SHOW_LIMIT = Number.parseInt(process.env.QA_SHOW_LIMIT ?? "10", 10) || 10;
const MIN_PREVIEW_CONFIDENCE = Number.parseFloat(process.env.PREVIEW_MIN_CONFIDENCE ?? "0.58") || 0.58;

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
  /^(education reporting is focused on|classroom-focused coverage now highlights|new school reporting points to)\b/i,
  /\bwhy it matters:\s*(district leaders and educators may need to adjust policy,\s*staffing,\s*or classroom practice\.?|school systems may need to revisit planning,\s*staffing,\s*or implementation decisions\.?|this could influence district priorities and how schools execute day-to-day operations\.?)$/i
];

const TRAILING_BOILERPLATE_PATTERNS = [
  /\bthe post\b[\s\S]{0,240}?\bappeared first on\b[\s\S]*$/i,
  /\bthis article (?:was )?originally (?:appeared|published) on\b[\s\S]*$/i,
  /\boriginally published (?:on|at)\b[\s\S]*$/i
];

const KEYWORDS = {
  impact: ["legislation", "bill", "policy", "funding", "budget", "superintendent", "district", "statewide", "board", "mandate"],
  urgency: ["emergency", "closure", "lockdown", "safety", "security", "threat", "shooting", "outbreak", "urgent"],
  novelty: ["pilot", "launch", "new", "first", "rollout", "initiative", "program", "expansion"],
  relevance: ["teacher", "students", "classroom", "curriculum", "school", "k-12", "k12", "principal", "edtech"]
};

const BREAKING_HINTS = [
  "breaking",
  "just announced",
  "emergency",
  "court blocks",
  "lawsuit",
  "injunction",
  "passes house",
  "passes senate",
  "signed into law",
  "state of emergency",
  "closure"
];

const POLICY_HINTS = [
  "policy",
  "bill",
  "law",
  "mandate",
  "regulation",
  "funding",
  "budget",
  "board",
  "superintendent",
  "federal",
  "state"
];

const OPINION_HINTS = [
  "opinion",
  "op-ed",
  "analysis",
  "commentary",
  "essay",
  "guest column",
  "letter to the editor"
];

const EVERGREEN_HINTS = [
  "how to",
  "guide",
  "tips",
  "checklist",
  "strategies",
  "lesson plan",
  "best practices",
  "classroom management",
  "worksheets",
  "activities",
  "explainer"
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

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

const STORY_QUERY = `
  select
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

function classifyStoryType(text, weakEvergreenSignals) {
  if (countHits(text, OPINION_HINTS) > 0) return "opinion";
  if (countHits(text, BREAKING_HINTS) > 0) return "breaking";
  if (countHits(text, POLICY_HINTS) > 0) return "policy";
  if (countHits(text, EVERGREEN_HINTS) > 0 && weakEvergreenSignals) return "evergreen";
  return "feature";
}

function analyzeStoryRanking(inputs) {
  const text = `${inputs.title} ${inputs.summary ?? ""}`;
  const impact = Math.min(countHits(text, KEYWORDS.impact), 3);
  const urgency = Math.min(countHits(text, KEYWORDS.urgency), 3);
  const novelty = Math.min(countHits(text, KEYWORDS.novelty), 3);
  const relevance = Math.min(countHits(text, KEYWORDS.relevance), 3);

  const sourceCount = Number.isFinite(inputs.sourceCount ?? 0) ? Number(inputs.sourceCount ?? 0) : 0;
  const recentCount = Number.isFinite(inputs.recentCount ?? 0) ? Number(inputs.recentCount ?? 0) : 0;
  const volume = Math.log1p(inputs.articleCount);
  const sourceDiversity = Math.log1p(Math.max(0, sourceCount));
  const hoursSince = (Date.now() - inputs.latestAt.getTime()) / (1000 * 60 * 60);
  const recency = 1.1 * Math.exp(-hoursSince / 30);
  const weakEvergreenSignals = hoursSince > 18 && sourceCount <= 1 && recentCount <= 1;
  const storyType = classifyStoryType(text, weakEvergreenSignals);
  const urgencyOverride = urgency > 0 && (hoursSince <= 6 || recentCount >= 2);
  const evergreenPenalty = storyType === "evergreen" && !urgencyOverride ? 0.45 : 1;
  const baseWeight = Math.max(0.45, Math.min(1.5, inputs.avgWeight));
  const authorityMultiplier = Math.max(0.3, Math.min(2.2, Math.pow(baseWeight, 3)));
  const lowAuthoritySingleton =
    sourceCount <= 1 && recentCount <= 1 && inputs.articleCount <= 1 && authorityMultiplier < 1;
  const singletonPenalty = !urgencyOverride && lowAuthoritySingleton ? 0.62 : 1;

  const base =
    impact * 2.2 +
    urgency * 1.8 +
    novelty * 1.0 +
    relevance * 1.0 +
    volume * 0.9 +
    sourceDiversity * 0.7 +
    recency;
  const score = base * authorityMultiplier * evergreenPenalty * singletonPenalty;

  let leadEligible = true;
  let leadReason = null;
  if (storyType === "evergreen" && !urgencyOverride) {
    leadEligible = false;
    leadReason = "evergreen_weak_signal";
  } else if (storyType === "opinion" && !urgencyOverride) {
    leadEligible = false;
    leadReason = "opinion_demoted";
  } else if (lowAuthoritySingleton && !urgencyOverride) {
    leadEligible = false;
    leadReason = "single_low_authority_source";
  }

  return {
    score: Number(score.toFixed(2)),
    storyType,
    leadEligible,
    leadReason,
    urgencyOverride,
    breakdown: {
      impact,
      urgency,
      novelty,
      relevance,
      volume: Number(volume.toFixed(2)),
      sourceDiversity: Number(sourceDiversity.toFixed(2)),
      recency: Number(recency.toFixed(2)),
      avgWeight: Number(baseWeight.toFixed(2)),
      authorityMultiplier: Number(authorityMultiplier.toFixed(2)),
      evergreenPenalty: Number(evergreenPenalty.toFixed(2)),
      singletonPenalty: Number(singletonPenalty.toFixed(2)),
      lowAuthoritySingleton,
      weakEvergreenSignals,
      hoursSince: Number(hoursSince.toFixed(2))
    }
  };
}

function chooseLeadStory(stories) {
  if (stories.length <= 1) return stories;
  if (stories[0]?.status === "pinned") return stories;

  const eligibleIndex = stories.findIndex((story) => story.lead_eligible);
  if (eligibleIndex <= 0) return stories;

  const [lead] = stories.splice(eligibleIndex, 1);
  if (!lead) return stories;
  stories.unshift(lead);
  return stories;
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
        const previewText = normalizeSummary(row.preview_text);
        const previewTypeRaw = String(row.preview_type ?? "").toLowerCase();
        const previewTypeValue =
          previewTypeRaw === "full" ||
          previewTypeRaw === "excerpt" ||
          previewTypeRaw === "headline_only" ||
          previewTypeRaw === "synthetic"
            ? previewTypeRaw
            : null;
        const previewConfidenceRaw = Number(row.preview_confidence ?? 0);
        const previewConfidence = Number(
          clamp(Number.isFinite(previewConfidenceRaw) ? previewConfidenceRaw : 0, 0, 1).toFixed(2)
        );

        const hasStructuredPreview =
          previewTypeValue === "full" || previewTypeValue === "excerpt" || previewTypeValue === "headline_only";
        let autoSummary = null;
        let autoPreviewType = "headline_only";
        let autoPreviewConfidence = previewConfidence;

        if (hasStructuredPreview) {
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
        const resolvedPreviewType = editorSummary ? "full" : autoPreviewType;
        const resolvedPreviewConfidence = editorSummary ? 1 : autoPreviewConfidence;
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
          } else if (resolvedPreviewConfidence < MIN_PREVIEW_CONFIDENCE + 0.08) {
            score = Number((score * 0.96).toFixed(2));
          }
        }

        return {
          ...row,
          summary: autoSummary,
          preview_type: resolvedPreviewType,
          preview_confidence: resolvedPreviewConfidence,
          editor_summary: editorSummary,
          article_count: Number(row.article_count),
          source_count: Number(row.source_count),
          recent_count: Number(row.recent_count),
          score,
          story_type: ranking.storyType,
          lead_eligible: ranking.leadEligible,
          lead_reason: ranking.leadReason,
          lead_urgency_override: ranking.urgencyOverride,
          score_breakdown: ranking.breakdown
        };
      });

    const pinned = scored.filter((story) => story.status === "pinned");
    const rest = scored.filter((story) => story.status !== "pinned");
    const ranked = [
      ...pinned.sort((a, b) => b.score - a.score),
      ...rest.sort((a, b) => b.score - a.score)
    ].slice(0, TOP_LIMIT);
    const leadAdjusted = chooseLeadStory([...ranked]);

    const displayRows = dedupeStorySummariesForDisplay(leadAdjusted);
    const summaries = displayRows
      .map((story) => story.editor_summary ?? story.summary)
      .filter(Boolean);
    const previewTypeCounts = displayRows.reduce((acc, story) => {
      const key = String(story.preview_type ?? "unknown");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

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
    const leadStory = displayRows[0] ?? null;
    const leadEligibilityIssues =
      leadStory && !leadStory.lead_eligible && displayRows.some((story, idx) => idx > 0 && story.lead_eligible);

    console.log(`Simulated homepage set: ${displayRows.length} stories (top limit ${TOP_LIMIT})`);
    console.log(`- Blank previews after filters/dedupe: ${blankShown}`);
    console.log(`- Synthetic fallback previews shown: ${syntheticShown}`);
    console.log(`- Near-duplicate preview pairs: ${duplicatePairs}`);
    console.log(`- Preview types: ${Object.entries(previewTypeCounts).map(([k, v]) => `${k}:${v}`).join(", ")}`);

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

    if (leadStory) {
      const leadTitle = String(leadStory.editor_title ?? leadStory.title ?? "").trim();
      console.log(
        `- Lead story: "${leadTitle}" (type=${leadStory.story_type}, eligible=${leadStory.lead_eligible}, reason=${leadStory.lead_reason ?? "ok"})`
      );
      console.log(`  score=${leadStory.score} breakdown=${JSON.stringify(leadStory.score_breakdown)}`);
    }
    if (leadEligibilityIssues) {
      console.log("- WARNING: lead story is not eligible while another eligible story exists.");
    }

    console.log("");
    console.log("Top ranking breakdown:");
    displayRows.slice(0, Math.min(5, displayRows.length)).forEach((story, index) => {
      const title = String(story.editor_title ?? story.title ?? "").trim();
      console.log(
        `${index + 1}. score=${story.score} type=${story.story_type} eligible=${story.lead_eligible} reason=${story.lead_reason ?? "ok"}`
      );
      console.log(`   ${truncate(title, 120)}`);
    });

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
