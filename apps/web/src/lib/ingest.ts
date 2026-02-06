import Parser from "rss-parser";
import { pool } from "./db";
import { getDefaultFeeds } from "./feeds";
import { TRUSTED_SITES, SOURCE_TIERS } from "@pulse/core";
import { groupUngroupedArticles } from "./grouping";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "PulseK12/1.0 (+https://pulsek12.com)"
  }
});

let anthropicAvailable: boolean | null = null;

const MAX_ITEMS_PER_FEED = 100;
const DOWNWEIGHT_PATTERNS = ["edtechinnovationhub", "ethi"];

const US_INDICATORS = [
  "united states",
  "u.s.",
  "usa",
  "district of columbia",
  "washington, dc",
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington state",
  "west virginia",
  "wisconsin",
  "wyoming"
];

const NON_US_INDICATORS = [
  "jordan",
  "canada",
  "ontario",
  "british columbia",
  "uk",
  "united kingdom",
  "england",
  "scotland",
  "wales",
  "ireland",
  "australia",
  "new zealand",
  "india",
  "china",
  "japan",
  "korea",
  "singapore",
  "uae",
  "saudi",
  "qatar",
  "brazil",
  "mexico",
  "france",
  "germany",
  "spain",
  "italy",
  "netherlands",
  "sweden",
  "norway",
  "finland",
  "denmark",
  "belgium",
  "switzerland",
  "austria",
  "poland",
  "czech",
  "slovakia",
  "hungary",
  "romania",
  "bulgaria",
  "greece",
  "turkey",
  "israel",
  "palestine",
  "gaza",
  "ukraine",
  "russia",
  "nigeria",
  "kenya",
  "south africa",
  "ghana",
  "egypt",
  "morocco",
  "algeria",
  "tunisia",
  "ethiopia",
  "pakistan",
  "bangladesh",
  "sri lanka",
  "nepal",
  "philippines",
  "indonesia",
  "malaysia",
  "thailand",
  "vietnam",
  "cambodia",
  "laos",
  "myanmar",
  "hong kong",
  "taiwan",
  "macau",
  "european union",
  "eu"
];

type IngestResult = {
  feeds: number;
  fetchedItems: number;
  inserted: number;
  updated: number;
  skipped: number;
  unresolvedGoogleSkipped: number;
  grouped: number;
  parseFailures: number;
  qualityChecked: number;
  nonArticleBlocked: number;
  nonArticleFlagged: number;
  summariesEnriched: number;
  summaryAdjudicatedAI: number;
  summaryAdjudicatedDeterministic: number;
  summaryGeneratedLLM: number;
  summaryRejected: number;
};

type ArticleQualityLabel = "article" | "non_article" | "uncertain";

type ArticleQualityDecision = {
  label: ArticleQualityLabel;
  score: number;
  reasons: string[];
};

type SummaryCandidateSource = "existing" | "rss" | "scrape" | "llm" | "fallback";

type SummaryCandidate = {
  source: SummaryCandidateSource;
  text: string;
  score: number;
};

type SummaryDecisionMethod = "ai" | "deterministic";

type SummaryDecision = {
  summary: string;
  source: SummaryCandidateSource;
  confidence: number;
  reasons: string[];
  method: SummaryDecisionMethod;
};

type StoryPreviewType = "full" | "excerpt" | "headline_only" | "synthetic";

type StoryPreviewDecision = {
  text: string | null;
  type: StoryPreviewType;
  confidence: number;
  reason: string;
};

type FillStorySummariesResult = {
  enriched: number;
  adjudicatedAI: number;
  adjudicatedDeterministic: number;
  llmGenerated: number;
  rejected: number;
};

const MIN_PREVIEW_CONFIDENCE = Number(process.env.PREVIEW_MIN_CONFIDENCE ?? "0.58");

function cleanTitle(title: string) {
  if (!title) return "";

  let cleaned = title.replace(/\s+/g, " ").trim();
  if (cleaned.includes(" - ")) {
    cleaned = cleaned.split(" - ").slice(0, -1).join(" - ").trim();
  }

  cleaned = cleaned
    .replace(/^[a-z][a-z\s&/+-]{1,30}\|\s*/i, "")
    .replace(/\s+[·|]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (/^from\s+[a-z]/i.test(cleaned) && cleaned.split(/\s+/).length <= 8) {
    return "";
  }

  return cleaned;
}

function normalizeUrl(input: string) {
  try {
    const url = new URL(input);
    url.hash = "";
    const params = url.searchParams;
    for (const key of Array.from(params.keys())) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || lower === "gclid" || lower === "fbclid") {
        params.delete(key);
      }
    }
    return url.toString();
  } catch {
    return input;
  }
}

function getDomain(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace("www.", "").toLowerCase();
  } catch {
    return "";
  }
}

const NON_ARTICLE_PATH_PATTERNS = [
  /\/profile(?:\/|$)/i,
  /\/profiles(?:\/|$)/i,
  /\/author(?:\/|$)/i,
  /\/authors(?:\/|$)/i,
  /\/about(?:\/|$)/i,
  /\/bio(?:\/|$)/i,
  /\/people(?:\/|$)/i,
  /\/person(?:\/|$)/i,
  /\/team(?:\/|$)/i,
  /\/experts?(?:\/|$)/i,
  /\/staff(?:\/|$)/i,
  /\/tag(?:\/|$)/i,
  /\/category(?:\/|$)/i,
  /\/topic(?:s)?(?:\/|$)/i,
  /\/search(?:\/|$)/i
];

const ARTICLE_PATH_HINT_PATTERNS = [
  /\/news(?:\/|$)/i,
  /\/article(?:s)?(?:\/|$)/i,
  /\/story(?:\/|$)/i,
  /\/[12][0-9]{3}\/[01]?[0-9](?:\/|$)/i
];

const BIOGRAPHY_TEXT_PATTERNS = [
  /\bwith over \d+ years of experience\b/i,
  /\bi have served\b/i,
  /\bi was a\b/i,
  /\bnonresident fellow\b/i,
  /\bfounder and principal\b/i,
  /\babout the author\b/i,
  /\bthis biography\b/i
];

const PROMOTIONAL_TEXT_PATTERNS = [
  /\bsubscribe\b/i,
  /\bnewsletter\b/i,
  /\brepublish\b/i,
  /\bsponsored\b/i,
  /\bpartner content\b/i
];

const SECTION_TITLE_PATTERNS = [
  /^from\s+[a-z]/i,
  /^(latest|breaking)\s+news\b/i,
  /^(news|opinion|podcast|video)\s*\|\s*[a-z]/i
];

const GENERIC_SECTION_SEGMENTS = new Set([
  "news",
  "latest",
  "topics",
  "topic",
  "opinion",
  "video",
  "podcast",
  "events",
  "national",
  "newyork",
  "philadelphia",
  "tennessee",
  "colorado"
]);

function clamp(value: number, min: number, max: number) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function looksLikePersonName(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 3) return false;
  return words.every((word) => /^[A-Z][A-Za-z'-]+$/.test(word));
}

function splitPathSegments(pathname: string) {
  return pathname
    .toLowerCase()
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function looksLikeSectionTitle(title: string) {
  const normalized = title.trim();
  if (!normalized) return false;
  if (SECTION_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  const tokens = normalized.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length <= 4 && tokens[0] === "from") return true;
  return false;
}

function looksLikeSectionIndexPath(pathname: string) {
  const segments = splitPathSegments(pathname);
  if (segments.length === 0) return true;

  if (segments.length === 1) {
    const first = segments[0];
    if (GENERIC_SECTION_SEGMENTS.has(first)) return true;
    if (!first.includes("-") && !/\d/.test(first) && first.length <= 24) return true;
    return false;
  }

  if (segments.length === 2) {
    const [first, second] = segments;
    if (GENERIC_SECTION_SEGMENTS.has(first) && !/\d/.test(second) && !second.includes("-")) {
      return true;
    }
  }

  return false;
}

function classifyArticleQuality(params: {
  url: string;
  title: string;
  summary: string | null | undefined;
}): ArticleQualityDecision {
  const title = params.title.trim();
  const summary = (params.summary ?? "").trim();
  const text = `${title} ${summary}`;
  const reasons: string[] = [];

  let score = 0.5;
  let pathname = "";
  try {
    pathname = new URL(params.url).pathname;
  } catch {
    pathname = "";
  }

  const hasNonArticlePath = NON_ARTICLE_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
  const hasArticlePathHint = ARTICLE_PATH_HINT_PATTERNS.some((pattern) => pattern.test(pathname));
  const hasBiographyText = BIOGRAPHY_TEXT_PATTERNS.some((pattern) => pattern.test(text));
  const hasPromoText = PROMOTIONAL_TEXT_PATTERNS.some((pattern) => pattern.test(text));
  const hasSectionTitle = looksLikeSectionTitle(title);
  const hasSectionIndexPath = looksLikeSectionIndexPath(pathname);
  const personNameTitle = looksLikePersonName(title);

  if (hasNonArticlePath) {
    score -= 0.55;
    reasons.push("non_article_url_path");
  }
  if (hasArticlePathHint) {
    score += 0.2;
    reasons.push("article_url_path_hint");
  }
  if (hasBiographyText) {
    score -= 0.45;
    reasons.push("biography_text_pattern");
  }
  if (hasPromoText) {
    score -= 0.25;
    reasons.push("promotional_text_pattern");
  }
  if (hasSectionTitle) {
    score -= 0.45;
    reasons.push("section_index_title");
  }
  if (hasSectionIndexPath && !hasArticlePathHint) {
    score -= 0.5;
    reasons.push("section_index_path");
  }
  if (personNameTitle) {
    score -= 0.2;
    reasons.push("person_name_title");
  }
  if (summary.length >= 80) {
    score += 0.08;
  }
  if (title.length >= 32 && !personNameTitle) {
    score += 0.08;
  }

  if (hasNonArticlePath && (hasBiographyText || personNameTitle)) {
    return {
      label: "non_article",
      score: 0.1,
      reasons: Array.from(new Set(reasons))
    };
  }

  if (
    hasSectionIndexPath &&
    (hasSectionTitle || summary.length < 70) &&
    !hasArticlePathHint
  ) {
    return {
      label: "non_article",
      score: 0.08,
      reasons: Array.from(new Set(reasons))
    };
  }

  const boundedScore = Number(clamp(score, 0, 1).toFixed(2));
  const label: ArticleQualityLabel =
    boundedScore <= 0.35 ? "non_article" : boundedScore >= 0.65 ? "article" : "uncertain";

  return {
    label,
    score: boundedScore,
    reasons: Array.from(new Set(reasons))
  };
}

function stripTags(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

const SUMMARY_JUNK_PATTERNS = [
  /sign up/i,
  /subscribe/i,
  /newsletter/i,
  /republish/i,
  /become a/i,
  /sponsor/i,
  /donate/i,
  /support( our)? journalism/i,
  /advertis/i,
  /getty images/i,
  /base64/i,
  /base64-image-removed/i,
  /streamlinehq/i,
  /share on/i,
  /follow us/i,
  /facebook|twitter|instagram|linkedin/i
];

const SYNTHETIC_FALLBACK_PATTERNS = [
  /^(new coverage highlights|recent reporting points to|new reporting points to|districts are now tracking)\b/i,
  /^(budget coverage now centers on|new (finance|budget) reporting highlights|district budget attention is shifting toward)\b/i,
  /^(policy coverage is focused on|legal and policy reporting now centers on|new governance reporting highlights)\b/i,
  /^(education reporting is focused on|classroom-focused coverage now highlights|new school reporting points to)\b/i
];

const TRAILING_BOILERPLATE_PATTERNS = [
  /\bthe post\b[\s\S]{0,240}?\bappeared first on\b[\s\S]*$/i,
  /\bthis article (?:was )?originally (?:appeared|published) on\b[\s\S]*$/i,
  /\boriginally published (?:on|at)\b[\s\S]*$/i
];

function isSyntheticFallbackSummary(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SYNTHETIC_FALLBACK_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function normalizeForSimilarity(text: string) {
  return text
    .toLowerCase()
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b\s+\d{1,2}\b/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMeaningfulTokens(text: string) {
  return normalizeForSimilarity(text)
    .split(" ")
    .filter((token) => token.length >= 4);
}

function isHeadlineEchoSummary(title: string, summary: string) {
  if (!title || !summary) return false;

  const titleNorm = normalizeForSimilarity(title);
  const summaryNorm = normalizeForSimilarity(summary);
  if (!titleNorm || !summaryNorm) return false;
  if (titleNorm === summaryNorm) return true;

  const titleTokens = new Set(getMeaningfulTokens(titleNorm));
  const summaryTokens = new Set(getMeaningfulTokens(summaryNorm));
  if (titleTokens.size === 0 || summaryTokens.size === 0) return false;

  let overlap = 0;
  for (const token of titleTokens) {
    if (summaryTokens.has(token)) overlap += 1;
  }
  const overlapRatio = overlap / Math.max(1, Math.min(titleTokens.size, summaryTokens.size));
  const summaryWordCount = summaryNorm.split(" ").filter(Boolean).length;
  const titleWordCount = titleNorm.split(" ").filter(Boolean).length;

  if (overlapRatio >= 0.92 && summaryWordCount <= titleWordCount + 7) return true;
  if (summaryNorm.startsWith(titleNorm) && summaryNorm.length <= titleNorm.length + 55) return true;
  return false;
}

function hashString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickVariant(seed: string, variants: string[]) {
  if (variants.length === 0) return "";
  const index = hashString(seed) % variants.length;
  return variants[index] ?? variants[0] ?? "";
}

function inferWhyItMattersLine(title: string) {
  const lower = title.toLowerCase();

  if (/(budget|funding|million|bond|tax|finance|deficit|spending)/i.test(lower)) {
    return pickVariant(lower, [
      "Why it matters: Budget decisions can directly affect staffing levels, programs, and student services.",
      "Why it matters: Funding shifts often change staffing plans, program availability, and district priorities.",
      "Why it matters: School finance changes can quickly impact classrooms and student support capacity."
    ]);
  }
  if (/(court|lawsuit|judge|bill|legislation|policy|ban|federal|state|compliance|board)/i.test(lower)) {
    return pickVariant(lower, [
      "Why it matters: Policy and legal changes can quickly reshape district rules and day-to-day school operations.",
      "Why it matters: New legal or policy decisions can force rapid district-level implementation changes.",
      "Why it matters: Governance shifts here may alter how schools operate in the near term."
    ]);
  }
  if (/(cellphone|phone|technology|ai|edtech|software|device|cybersecurity|data)/i.test(lower)) {
    return pickVariant(lower, [
      "Why it matters: Districts may need to update classroom expectations, training, and implementation plans.",
      "Why it matters: Technology decisions here can affect instruction, policy enforcement, and staff training.",
      "Why it matters: Schools may need clearer implementation plans and communication with educators and families."
    ]);
  }
  if (/(literacy|math|reading|curriculum|instruction|attendance|discipline|special education)/i.test(lower)) {
    return pickVariant(lower, [
      "Why it matters: Classroom practice and student outcomes can shift as districts adopt new approaches.",
      "Why it matters: Instructional changes here can affect day-to-day teaching and student progress.",
      "Why it matters: District response may influence curriculum choices, classroom routines, and supports."
    ]);
  }

  return pickVariant(lower, [
    "Why it matters: District leaders and educators may need to adjust policy, staffing, or classroom practice.",
    "Why it matters: School systems may need to revisit planning, staffing, or implementation decisions.",
    "Why it matters: This could influence district priorities and how schools execute day-to-day operations."
  ]);
}

function sanitizeHeadlineTopic(title: string) {
  return title
    .replace(/^[^|]{1,40}\|\s*/g, "")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b\s+\d{1,2}\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[?!.…]+$/g, "")
    .trim();
}

function createFallbackSummaryFromTitle(title: string) {
  const topic = sanitizeHeadlineTopic(title);
  if (!topic || topic.length < 12) return "";
  if (looksLikeSectionTitle(topic)) return "";

  const topicLower = topic.charAt(0).toLowerCase() + topic.slice(1);
  let lead = pickVariant(topicLower, [
    `New coverage highlights ${topicLower}.`,
    `Recent reporting points to ${topicLower}.`,
    `Districts are now tracking ${topicLower}.`
  ]);
  if (/(budget|funding|tax|bond|spending|deficit)/i.test(topic)) {
    lead = pickVariant(topicLower, [
      `Budget coverage now centers on ${topicLower}.`,
      `New finance reporting highlights ${topicLower}.`,
      `District budget attention is shifting toward ${topicLower}.`
    ]);
  } else if (/(lawsuit|court|bill|policy|ban|federal|state)/i.test(topic)) {
    lead = pickVariant(topicLower, [
      `Policy coverage is focused on ${topicLower}.`,
      `Legal and policy reporting now centers on ${topicLower}.`,
      `New governance reporting highlights ${topicLower}.`
    ]);
  } else if (/(teacher|students|curriculum|classroom|literacy|math|attendance)/i.test(topic)) {
    lead = pickVariant(topicLower, [
      `Education reporting is focused on ${topicLower}.`,
      `Classroom-focused coverage now highlights ${topicLower}.`,
      `New school reporting points to ${topicLower}.`
    ]);
  }

  const summary = `${lead} ${inferWhyItMattersLine(topic)}`;
  return sanitizeSummary(summary);
}

function buildStoryWhyItMattersSummary(params: {
  storyTitle: string;
  selectedSummary: string;
  supportingSummaries: string[];
}) {
  const { storyTitle, selectedSummary, supportingSummaries } = params;

  let base = sanitizeSummary(selectedSummary);
  const baseIsFallback = base ? isSyntheticFallbackSummary(base) : false;
  const baseIsUsable = Boolean(base) && !baseIsFallback && !isHeadlineEchoSummary(storyTitle, base ?? "");

  if (baseIsUsable) {
    return base ?? "";
  }

  if (!base || baseIsFallback || isHeadlineEchoSummary(storyTitle, base)) {
    const alternate = supportingSummaries
      .map((summary) => sanitizeSummary(summary))
      .find((summary) => summary && !isSyntheticFallbackSummary(summary) && !isHeadlineEchoSummary(storyTitle, summary));
    if (alternate) {
      base = alternate;
    }
  }

  if (!base || isSyntheticFallbackSummary(base) || isHeadlineEchoSummary(storyTitle, base)) {
    base = createFallbackSummaryFromTitle(storyTitle);
  }
  return base ? sanitizeSummary(base) : "";
}

function decideStoryPreview(params: {
  storyTitle: string;
  selectedSummary: string;
  decision: SummaryDecision;
}): StoryPreviewDecision {
  const { storyTitle, selectedSummary, decision } = params;
  const cleaned = sanitizeSummary(selectedSummary);
  const confidence = Number(clamp(decision.confidence, 0, 1).toFixed(2));

  if (!cleaned) {
    return {
      text: null,
      type: "headline_only",
      confidence: 0,
      reason: "empty_preview_text"
    };
  }

  const isFallbackSource = decision.source === "fallback";
  const isSyntheticText = isSyntheticFallbackSummary(cleaned);
  const isHeadlineEcho = isHeadlineEchoSummary(storyTitle, cleaned);

  if (isFallbackSource || isSyntheticText || isHeadlineEcho) {
    return {
      text: null,
      type: "headline_only",
      confidence: Number(clamp(confidence, 0, 0.34).toFixed(2)),
      reason: isFallbackSource
        ? "fallback_suppressed"
        : isSyntheticText
          ? "synthetic_suppressed"
          : "headline_echo_suppressed"
    };
  }

  if (confidence < MIN_PREVIEW_CONFIDENCE) {
    return {
      text: null,
      type: "headline_only",
      confidence,
      reason: "low_confidence"
    };
  }

  return {
    text: cleaned,
    type: decision.source === "llm" ? "full" : "excerpt",
    confidence,
    reason: decision.reasons[0] ?? "candidate_selected"
  };
}

function hasExcessiveRepetition(text: string) {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

  if (words.length < 16) return false;

  const uniqueRatio = new Set(words).size / words.length;
  return uniqueRatio < 0.55;
}

function sanitizeSummary(text: string) {
  if (!text) return "";
  let cleaned = text
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

  for (const pattern of SUMMARY_JUNK_PATTERNS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.split(pattern)[0]?.trim() ?? cleaned;
      break;
    }
  }

  cleaned = cleaned.replace(/\([^)]*Getty Images[^)]*\)/gi, "").trim();
  if (/(?:\bcontact\b.*){2,}/i.test(cleaned)) return "";
  if (/(?:\bdownloads?\b.*){2,}/i.test(cleaned)) return "";
  if (/(?:\bshare\b.*){3,}/i.test(cleaned)) return "";
  if (hasExcessiveRepetition(cleaned)) return "";

  if (!cleaned || cleaned.length < 40) return "";
  if (cleaned.length > 320) cleaned = `${cleaned.slice(0, 320).trim()}…`;
  return cleaned;
}

function isLowQualitySummary(text: string) {
  if (!text) return true;
  if (text.length < 40) return true;
  if (SUMMARY_JUNK_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (/(?:\bcontact\b.*){2,}/i.test(text)) return true;
  if (/(?:\bdownloads?\b.*){2,}/i.test(text)) return true;
  if (/(?:\bshare\b.*){3,}/i.test(text)) return true;
  if (hasExcessiveRepetition(text)) return true;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return wordCount < 8;
}

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

function isGenericLinkText(text: string) {
  const lower = text.toLowerCase();
  if (!lower) return true;
  return (
    lower.length < 12 ||
    ["read more", "learn more", "continue reading", "view all", "subscribe", "watch", "listen"].some(
      (phrase) => lower.includes(phrase)
    )
  );
}

function buildTitleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const slug = segments[segments.length - 1] || "";
    const raw = decodeURIComponent(
      slug.replace(/[-_]+/g, " ").replace(/\.[a-z0-9]+$/i, "")
    );
    return normalizeTitleCase(raw)
      .trim()
      .replace(/\s+/g, " ");
  } catch {
    return "";
  }
}

function isLikelyArticlePath(pathname: string) {
  const lower = pathname.toLowerCase();
  if (!pathname || pathname === "/") return false;
  if (
    lower.includes("/profile/") ||
    lower.includes("/profiles/") ||
    lower.includes("/tag/") ||
    lower.includes("/category/") ||
    lower.includes("/topics/") ||
    lower.includes("/topic/") ||
    lower.includes("/authors/") ||
    lower.includes("/author/") ||
    lower.includes("/people/") ||
    lower.includes("/person/") ||
    lower.includes("/experts/") ||
    lower.includes("/expert/") ||
    lower.includes("/staff/") ||
    lower.includes("/team/") ||
    lower.includes("/about/") ||
    lower.includes("/bio/") ||
    lower.includes("/search")
  ) {
    return false;
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".png") || lower.endsWith(".pdf")) {
    return false;
  }
  if (looksLikeSectionIndexPath(pathname) && !ARTICLE_PATH_HINT_PATTERNS.some((p) => p.test(lower))) {
    return false;
  }

  return true;
}

function extractLinksFromHtml(html: string, baseUrl: string, domain: string) {
  const links: { url: string; title: string }[] = [];
  const seen = new Set<string>();
  const regex = /<a\s+[^>]*href=(\"|')(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  let count = 0;

  while ((match = regex.exec(html)) && count < 400) {
    count += 1;
    const href = match[2];
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) {
      continue;
    }
    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const linkDomain = getDomain(resolved);
    if (!linkDomain || (linkDomain !== domain && !linkDomain.endsWith(`.${domain}`))) {
      continue;
    }
    const { pathname } = new URL(resolved);
    if (!isLikelyArticlePath(pathname)) {
      continue;
    }
    const rawText = decodeEntities(stripTags(match[3] || ""));
    const attrTitleMatch = match[0].match(/title=(\"|')([^\"']+)\1/i);
    const attrTitle = attrTitleMatch ? decodeEntities(stripTags(attrTitleMatch[2])) : "";
    const shouldFallback =
      isGenericLinkText(rawText) ||
      rawText.length > 160 ||
      rawText.split(" ").length > 24;
    const title = shouldFallback
      ? attrTitle && !isGenericLinkText(attrTitle) && attrTitle.length <= 160
        ? attrTitle
        : buildTitleFromUrl(resolved)
      : rawText;
    if (!title || isGenericLinkText(title)) {
      continue;
    }
    const normalized = normalizeUrl(resolved);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    links.push({ url: normalized, title });
  }

  return links;
}

function isJobListing(title: string, url: string) {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("/jobs/") || lowerUrl.includes("/careers/")) return true;
  if (lowerUrl.includes("://jobs.")) return true;
  const lowerTitle = title.toLowerCase();
  return (
    lowerTitle.startsWith("job:") ||
    lowerTitle.includes("job opening") ||
    lowerTitle.includes("now hiring")
  );
}

function extractMetaDescription(html: string) {
  const patterns = [
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["'][^>]*>/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return sanitizeSummary(decodeEntities(stripTags(match[1])));
    }
  }
  return "";
}

function extractFirstParagraph(html: string) {
  const match = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!match?.[1]) return "";
  return sanitizeSummary(decodeEntities(stripTags(match[1])));
}

async function fetchArticleSummary(url: string) {
  const data = await fetchFirecrawlScrape(url, ["markdown", "html"], {
    onlyMainContent: true
  });
  const markdown = data?.markdown as string | undefined;
  if (markdown) {
    const cleaned = markdown.replace(/\r\n/g, "\n");
    for (const block of cleaned.split(/\n{2,}/)) {
      const text = sanitizeSummary(
        block
          .replace(/^#+\s*/g, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .trim()
      );
      if (text) return text;
    }
  }
  const html = (data?.html as string | undefined) ?? "";
  const meta = html ? extractMetaDescription(html) : "";
  if (meta) return meta;
  const first = html ? extractFirstParagraph(html) : "";
  return first.length > 0 ? first : "";
}

async function fetchArticleMarkdown(url: string) {
  const data = await fetchFirecrawlScrape(url, ["markdown"], {
    onlyMainContent: true
  });
  const markdown = (data?.markdown as string | undefined) ?? "";
  return markdown.trim();
}

async function generateAnthropicSummary(title: string, markdown: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";
  if (anthropicAvailable === false) return "";
  if (!markdown) return "";

  const modelCandidates = [
    process.env.ANTHROPIC_MODEL,
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest"
  ].filter(Boolean) as string[];
  const trimmed = markdown
    .split("\n")
    .filter((line) => !SUMMARY_JUNK_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .slice(0, 4000);
  const prompt = `You are writing a concise brief for US K-12 educators.\n\nTitle: ${title}\n\nSource text:\n${trimmed}\n\nWrite 1-2 sentences (max 45 words). Use only the source text. Avoid boilerplate (subscribe, republish, sponsor, ads, navigation). Avoid hype or speculation.`;

  for (const model of modelCandidates) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 120,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      if (response.status === 404) {
        anthropicAvailable = false;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        anthropicAvailable = false;
      }
      console.error(`[ingest] anthropic error ${response.status}`);
      return "";
    }

    anthropicAvailable = true;
    const payload = await response.json();
    const text = payload?.content?.[0]?.text;
    if (!text || typeof text !== "string") return "";
    return text.trim();
  }

  console.error("[ingest] anthropic error 404 across candidate models");
  anthropicAvailable = false;
  return "";
}

function scoreSummaryCandidate(title: string, text: string, source: SummaryCandidateSource) {
  const cleaned = sanitizeSummary(text);
  if (!cleaned) return 0;

  if (source === "fallback") {
    return 0.38;
  }

  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  let score = 0.45;

  if (!isLowQualitySummary(cleaned)) score += 0.25;
  if (wordCount >= 10) score += 0.12;
  if (wordCount >= 16) score += 0.08;
  if (wordCount > 60) score -= 0.08;
  if (/(district|school board|state|federal|teacher|students|curriculum|funding|policy|classroom|superintendent|principal|k-12|education)/i.test(cleaned)) {
    score += 0.07;
  }
  if (/\d/.test(cleaned)) score += 0.03;
  if (isHeadlineEchoSummary(title, cleaned)) score -= 0.4;
  if (isSyntheticFallbackSummary(cleaned)) score -= 0.35;

  return Number(clamp(score, 0, 1).toFixed(2));
}

function addSummaryCandidate(
  candidates: SummaryCandidate[],
  source: SummaryCandidateSource,
  text: string | null | undefined,
  title: string
) {
  const cleaned = sanitizeSummary(text ?? "");
  if (!cleaned) return false;
  if (isHeadlineEchoSummary(title, cleaned)) {
    return false;
  }
  const duplicate = candidates.some(
    (candidate) => candidate.text.toLowerCase() === cleaned.toLowerCase()
  );
  if (duplicate) return false;

  candidates.push({
    source,
    text: cleaned,
    score: scoreSummaryCandidate(title, cleaned, source)
  });

  return true;
}

function deterministicSummaryDecision(candidates: SummaryCandidate[]): SummaryDecision | null {
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.text.length - a.text.length;
  });

  const winner = sorted[0];
  if (!winner) return null;

  const runnerUp = sorted[1];
  const gap = runnerUp ? Math.max(0, winner.score - runnerUp.score) : 0.2;
  const confidence = Number(
    clamp(0.52 + gap * 0.9 + Math.max(0, winner.score - 0.55) * 0.35, 0.35, 0.9).toFixed(2)
  );

  const reasons = ["heuristic_quality_score"];
  if (gap >= 0.12) reasons.push("clear_quality_margin");
  if (winner.source === "scrape") reasons.push("scraped_main_content");
  if (winner.source === "llm") reasons.push("llm_rewrite_selected");
  if (winner.source === "fallback") reasons.push("fallback_generated_brief");

  return {
    summary: winner.text,
    source: winner.source,
    confidence,
    reasons,
    method: "deterministic"
  };
}

type AISummaryAdjudication = {
  winnerSource: SummaryCandidateSource | "reject";
  confidence: number;
  reasons: string[];
};

function extractFirstJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return "";
  return text.slice(start, end + 1);
}

function normalizeReasonCodes(reasons: unknown) {
  if (!Array.isArray(reasons)) return ["unknown_reason"];
  const normalized = reasons
    .map((value) =>
      String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    )
    .filter(Boolean);
  return normalized.length > 0 ? normalized.slice(0, 5) : ["unknown_reason"];
}

async function adjudicateSummaryWithAnthropic(
  title: string,
  url: string,
  candidates: SummaryCandidate[]
): Promise<AISummaryAdjudication | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || candidates.length === 0) return null;
  if (anthropicAvailable === false) return null;

  const modelCandidates = [
    process.env.ANTHROPIC_MODEL,
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest"
  ].filter(Boolean) as string[];
  const candidateBlock = candidates
    .map((candidate, index) => `${index + 1}. [${candidate.source}] ${candidate.text}`)
    .join("\n");

  const prompt = [
    "You are a strict summary quality judge for a US K-12 education news homepage.",
    `Article title: ${title}`,
    `Article URL: ${url}`,
    "",
    "Pick the best candidate summary.",
    "Reject all candidates only if all are low-quality, promotional, noisy, or off-topic.",
    "Allowed reason codes: factual_specificity, relevance_k12, clarity, low_noise, non_promotional, concise, stale_or_vague, insufficient_quality.",
    "",
    "Return ONLY JSON with this exact shape:",
    '{"winnerSource":"existing|rss|scrape|llm|fallback|reject","confidence":0.0,"reasons":["reason_code"]}',
    "",
    "Candidates:",
    candidateBlock
  ].join("\n");

  for (const model of modelCandidates) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 180,
        temperature: 0,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      if (response.status === 404) {
        anthropicAvailable = false;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        anthropicAvailable = false;
      }
      console.error(`[ingest] adjudicator error ${response.status}`);
      return null;
    }

    anthropicAvailable = true;
    const payload = await response.json();
    const text = payload?.content?.[0]?.text;
    if (!text || typeof text !== "string") return null;

    const jsonText = extractFirstJsonObject(text);
    if (!jsonText) return null;

    try {
      const parsed = JSON.parse(jsonText) as {
        winnerSource?: string;
        confidence?: number;
        reasons?: unknown;
      };
      const allowed = new Set<SummaryCandidateSource | "reject">([
        "existing",
        "rss",
        "scrape",
        "llm",
        "fallback",
        "reject"
      ]);
      const winnerSource = (parsed.winnerSource ?? "").toLowerCase() as
        | SummaryCandidateSource
        | "reject";
      if (!allowed.has(winnerSource)) return null;
      const confidence = Number(
        clamp(
          typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
          0,
          1
        ).toFixed(2)
      );
      const reasons = normalizeReasonCodes(parsed.reasons);
      return { winnerSource, confidence, reasons };
    } catch {
      return null;
    }
  }

  console.error("[ingest] adjudicator error 404 across candidate models");
  anthropicAvailable = false;
  return null;
}

async function decideSummaryCandidate(params: {
  title: string;
  url: string;
  candidates: SummaryCandidate[];
  allowAI: boolean;
}) {
  const { title, url, candidates, allowAI } = params;
  if (candidates.length === 0) {
    return {
      decision: null as SummaryDecision | null,
      usedAI: false,
      rejected: true
    };
  }

  if (allowAI && candidates.length > 1) {
    const aiDecision = await adjudicateSummaryWithAnthropic(title, url, candidates);
    if (aiDecision) {
      if (aiDecision.winnerSource === "reject") {
        const fallback = deterministicSummaryDecision(candidates);
        if (fallback) {
          return {
            decision: {
              ...fallback,
              reasons: Array.from(new Set([...fallback.reasons, "ai_reject_fallback"]))
            },
            usedAI: true,
            rejected: false
          };
        }
        return {
          decision: null as SummaryDecision | null,
          usedAI: true,
          rejected: true
        };
      }

      const winner = candidates.find(
        (candidate) => candidate.source === aiDecision.winnerSource
      );
      if (winner) {
        return {
          decision: {
            summary: winner.text,
            source: winner.source,
            confidence: aiDecision.confidence,
            reasons: aiDecision.reasons,
            method: "ai" as SummaryDecisionMethod
          },
          usedAI: true,
          rejected: false
        };
      }
    }
  }

  const fallback = deterministicSummaryDecision(candidates);
  return {
    decision: fallback,
    usedAI: false,
    rejected: !fallback
  };
}

function isUSOnlyStory(title: string, summary: string) {
  const text = `${title} ${summary}`.toLowerCase();
  const hasUS = US_INDICATORS.some((term) => text.includes(term));
  const hasNonUS = NON_US_INDICATORS.some((term) => text.includes(term));
  return !(hasNonUS && !hasUS);
}

function isUnresolvedGoogleNewsUrl(url: string) {
  return /news\.google\.com\/rss\/articles\//i.test(url);
}

async function resolveGoogleNewsUrl(url: string) {
  if (!url.includes("news.google.com")) return url;
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent": "PulseK12/1.0 (+https://pulsek12.com)"
      }
    });
    return response.url || url;
  } catch {
    return url;
  }
}

async function ensureSource(
  name: string,
  domain: string,
  tierHint: "A" | "B" | "C" | "unknown"
) {
  if (!domain) return null;

  const existing = await pool.query(
    "select id from sources where domain = $1",
    [domain]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id as string;
  }

  const isTrusted = TRUSTED_SITES.includes(domain);
  const tierALocalJournalism = SOURCE_TIERS.tierA.localJournalism as readonly string[];
  const tierAStateEducation = SOURCE_TIERS.tierA.stateEducation as readonly string[];
  const tierBDomains = SOURCE_TIERS.tierB.domains as readonly string[];
  const tierCDomains = SOURCE_TIERS.tierC.domains as readonly string[];
  const tier =
    tierHint !== "unknown"
      ? tierHint
      : tierALocalJournalism.includes(domain) ||
          tierAStateEducation.includes(domain) ||
          SOURCE_TIERS.tierA.govPatterns.some((pattern) => domain.includes(pattern))
        ? "A"
        : tierBDomains.includes(domain) ||
            SOURCE_TIERS.tierB.localTvPatterns.some((pattern) =>
              domain.includes(pattern)
            )
          ? "B"
          : tierCDomains.includes(domain) ||
              SOURCE_TIERS.tierC.patterns.some((pattern) =>
                domain.includes(pattern)
              )
            ? "C"
            : "unknown";
  if (tier === "C") {
    return null;
  }

  let weight = isTrusted ? 1.2 : tier === "A" ? 1.1 : tier === "B" ? 1.0 : 0.9;
  if (DOWNWEIGHT_PATTERNS.some((pattern) => domain.includes(pattern))) {
    weight = Math.min(weight, 0.7);
  }

  const inserted = await pool.query(
    "insert into sources (name, domain, tier, weight) values ($1, $2, $3, $4) returning id",
    [name || domain, domain, tier, weight]
  );

  return inserted.rows[0].id as string;
}

async function ensureFeed(url: string, sourceId: string, feedType: string) {
  const existing = await pool.query("select id from feeds where url = $1", [url]);
  if (existing.rows.length > 0) {
    return existing.rows[0].id as string;
  }

  const inserted = await pool.query(
    "insert into feeds (source_id, url, feed_type) values ($1, $2, $3) returning id",
    [sourceId, url, feedType]
  );
  return inserted.rows[0].id as string;
}

async function fetchFirecrawlScrape(
  url: string,
  formats: string[],
  options?: { onlyMainContent?: boolean }
) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set");
  }
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ url, formats, ...options })
  });
  if (!response.ok) {
    throw new Error(`Firecrawl ${response.status}`);
  }
  const payload = await response.json();
  if (!payload?.success) {
    throw new Error(payload?.error ?? "Firecrawl failed");
  }
  return payload?.data ?? {};
}

async function fetchFirecrawlHtml(url: string) {
  const data = await fetchFirecrawlScrape(url, ["html"]);
  const html = data?.html;
  if (!html) {
    throw new Error("Firecrawl returned empty html");
  }
  return html as string;
}

async function parseScrapeFeed(url: string, domain: string) {
  const html = await fetchFirecrawlHtml(url);
  const links = extractLinksFromHtml(html, url, domain).slice(0, MAX_ITEMS_PER_FEED);
  return {
    items: links.map((link) => ({
      title: link.title,
      link: link.url
    }))
  };
}

export async function fillStorySummaries(
  limit: number,
  storyIds?: string[],
  allowAI = false,
  aiLimit = 0
): Promise<FillStorySummariesResult> {
  const params: (number | string[])[] = [limit];
  let where = `where
    s.summary is null
    or length(trim(s.summary)) = 0
    or length(trim(s.summary)) < 40
    or s.summary ~* '(sign up|subscribe|newsletter|republish|sponsor|advertis|getty images|base64|streamlinehq|share on|follow us|facebook|twitter|instagram|linkedin)'
    or s.summary ~* '!\\[[^\\]]*\\]\\('
    or s.summary ~* '(contact.*contact|downloads?.*downloads?|share.*share.*share)'
    or s.summary ~* '^(new coverage highlights|recent reporting points to|new reporting points to|districts are now tracking|budget coverage now centers on|new (finance|budget) reporting highlights|district budget attention is shifting toward|policy coverage is focused on|legal and policy reporting now centers on|new governance reporting highlights|education reporting is focused on|classroom-focused coverage now highlights|new school reporting points to)'
    or (s.title is not null and s.summary is not null and lower(trim(s.summary)) like lower(trim(s.title)) || '%')
    or s.preview_type is null
    or s.preview_type = 'synthetic'
    or (s.preview_reason is null and s.preview_text is null)
    or (s.preview_type <> 'headline_only' and (s.preview_text is null or length(trim(s.preview_text)) = 0))`;
  if (storyIds && storyIds.length > 0) {
    where += " and s.id = any($2::uuid[])";
    params.push(storyIds);
  }

  const result = await pool.query(
    `select
       s.id as story_id,
       s.title as story_title,
       a.id as article_id,
       a.title as article_title,
       a.url,
       a.summary
     from stories s
     join lateral (
       select a1.id, a1.title, a1.url, a1.summary, a1.published_at, a1.fetched_at
     from story_articles sa1
      join articles a1 on a1.id = sa1.article_id
      where sa1.story_id = s.id
        and coalesce(a1.quality_label, 'unknown') <> 'non_article'
        and a1.url not ilike 'https://news.google.com/rss/articles/%'
      order by coalesce(a1.published_at, a1.fetched_at) desc
      limit 1
     ) a on true
     ${where}
     order by s.last_seen_at desc
     limit $1`,
    params
  );

  let enriched = 0;
  let fetched = 0;
  let adjudicatedAI = 0;
  let adjudicatedDeterministic = 0;
  let llmGenerated = 0;
  let rejected = 0;
  let aiRemaining = aiLimit === 0 ? Number.POSITIVE_INFINITY : aiLimit;
  const fetchLimit = Math.min(limit, 30);
  const canUseAI = allowAI && Boolean(process.env.ANTHROPIC_API_KEY);

  for (const row of result.rows) {
    const summaryTitle = (row.article_title as string | null) ?? (row.story_title as string) ?? "";
    const candidates: SummaryCandidate[] = [];
    addSummaryCandidate(candidates, "existing", row.summary as string | null, summaryTitle);

    const hasStrongNonFallback = candidates.some(
      (candidate) => candidate.source !== "fallback" && candidate.score >= 0.72
    );
    if (!hasStrongNonFallback && fetched < fetchLimit) {
      try {
        const scraped = await fetchArticleSummary(row.url as string);
        const added = addSummaryCandidate(candidates, "scrape", scraped, summaryTitle);
        if (added) {
          fetched += 1;
        }
      } catch (error) {
        console.error(
          `[ingest] failed to enrich story summary ${row.url}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (candidates.length === 0) {
      addSummaryCandidate(candidates, "fallback", createFallbackSummaryFromTitle(summaryTitle), summaryTitle);
    }

    const shouldGenerateLLM =
      canUseAI &&
      aiRemaining > 0 &&
      (
        candidates.filter((candidate) => candidate.source !== "fallback").length === 0 ||
        candidates
          .filter((candidate) => candidate.source !== "fallback")
          .every((candidate) => candidate.score < 0.68)
      );
    if (shouldGenerateLLM) {
      try {
        const markdown = await fetchArticleMarkdown(row.url as string);
        const llm = await generateAnthropicSummary(
          summaryTitle,
          markdown
        );
        if (addSummaryCandidate(candidates, "llm", llm, summaryTitle)) {
          llmGenerated += 1;
          if (Number.isFinite(aiRemaining)) {
            aiRemaining -= 1;
          }
        }
      } catch (error) {
        console.error(
          `[ingest] failed to generate summary ${row.url}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const adjudication = await decideSummaryCandidate({
      title: (row.article_title as string | null) ?? (row.story_title as string),
      url: row.url as string,
      candidates,
      allowAI: canUseAI && aiRemaining > 0
    });

    if (adjudication.usedAI) {
      if (Number.isFinite(aiRemaining)) {
        aiRemaining -= 1;
      }
      adjudicatedAI += 1;
    } else {
      adjudicatedDeterministic += 1;
    }

    if (adjudication.rejected || !adjudication.decision) {
      rejected += 1;
      console.warn(`[ingest] summary rejected for ${row.url}`);
      await pool.query(
        `update stories
         set preview_text = null,
             preview_type = 'headline_only',
             preview_confidence = 0,
             preview_reason = 'adjudication_rejected',
             updated_at = now()
         where id = $1`,
        [row.story_id]
      );
      continue;
    }

    const summary = sanitizeSummary(adjudication.decision.summary);
    if (!summary) {
      rejected += 1;
      console.warn(`[ingest] summary empty for ${row.url}`);
      await pool.query(
        `update stories
         set preview_text = null,
             preview_type = 'headline_only',
             preview_confidence = 0,
             preview_reason = 'empty_summary',
             updated_at = now()
         where id = $1`,
        [row.story_id]
      );
      continue;
    }

    const supportingResult = await pool.query(
      `select a.summary
       from story_articles sa
       join articles a on a.id = sa.article_id
       where sa.story_id = $1
         and coalesce(a.quality_label, 'unknown') <> 'non_article'
         and a.summary is not null
       order by
         coalesce(a.summary_choice_confidence, 0) desc,
         coalesce(a.summary_choice_checked_at, a.published_at, a.fetched_at) desc
       limit 3`,
      [row.story_id]
    );
    const supportingSummaries = supportingResult.rows
      .map((item: { summary: string | null }) => sanitizeSummary((item.summary as string | null) ?? ""))
      .filter(Boolean);
    const storySummary = buildStoryWhyItMattersSummary({
      storyTitle: (row.story_title as string | null) ?? summaryTitle,
      selectedSummary: summary,
      supportingSummaries
    });
    const finalStorySummary = storySummary || summary;
    const preview = decideStoryPreview({
      storyTitle: (row.story_title as string | null) ?? summaryTitle,
      selectedSummary: summary,
      decision: adjudication.decision
    });

    const candidatePayload = JSON.stringify(
      candidates.map((candidate) => ({
        source: candidate.source,
        score: candidate.score,
        text: candidate.text
      }))
    );

    await pool.query(
      `update articles
       set summary = case
         when summary is null or length(trim(summary)) = 0 then $2
         when length(trim(summary)) < 40 then $2
         when summary ~* '(sign up|subscribe|newsletter|republish|sponsor|advertis|getty images|base64|streamlinehq|share on|follow us|facebook|twitter|instagram|linkedin)' then $2
         when summary ~* '!\\[[^\\]]*\\]\\(' then $2
         when summary ~* '(contact.*contact|downloads?.*downloads?|share.*share.*share)' then $2
         when length($2) > length(summary) then $2
         else summary
       end,
           summary_choice_source = $3,
           summary_choice_method = $4,
           summary_choice_confidence = $5,
           summary_choice_reasons = $6,
           summary_choice_checked_at = now(),
           summary_candidates = $7::jsonb
       where id = $1`,
      [
        row.article_id,
        summary,
        adjudication.decision.source,
        adjudication.decision.method,
        adjudication.decision.confidence,
        adjudication.decision.reasons,
        candidatePayload
      ]
    );

    await pool.query(
      `update stories
       set summary = $2,
           preview_text = $3,
           preview_type = $4,
           preview_confidence = $5,
           preview_reason = $6,
           updated_at = now()
       where id = $1`,
      [
        row.story_id,
        finalStorySummary,
        preview.text,
        preview.type,
        preview.confidence,
        preview.reason
      ]
    );

    const storyTitle = (row.story_title as string | null) ?? "";
    const articleTitle = (row.article_title as string | null) ?? "";
    const storyWordCount = storyTitle.split(" ").filter(Boolean).length;
    if (storyTitle.length > 160 || storyWordCount > 24) {
      if (articleTitle && articleTitle.length < storyTitle.length) {
        await pool.query(
          `update stories
           set title = $2,
               updated_at = now()
           where id = $1`,
          [row.story_id, articleTitle]
        );
      }
    }

    enriched += 1;
  }

  return {
    enriched,
    adjudicatedAI,
    adjudicatedDeterministic,
    llmGenerated,
    rejected
  };
}

async function classifyRecentArticles(limit: number) {
  const result = await pool.query(
    `select id, url, title, summary
     from articles
     order by coalesce(published_at, fetched_at) desc
     limit $1`,
    [limit]
  );

  let qualityChecked = 0;
  let nonArticleFlagged = 0;

  for (const row of result.rows) {
    const decision = classifyArticleQuality({
      url: (row.url as string) ?? "",
      title: (row.title as string | null) ?? "",
      summary: row.summary as string | null
    });

    await pool.query(
      `update articles
       set quality_label = $2,
           quality_score = $3,
           quality_reasons = $4,
           quality_checked_at = now()
       where id = $1`,
      [row.id, decision.label, decision.score, decision.reasons]
    );

    qualityChecked += 1;
    if (decision.label === "non_article") {
      nonArticleFlagged += 1;
    }
  }

  return { qualityChecked, nonArticleFlagged };
}

async function loadFeedRegistry() {
  const existing = await pool.query(
    `select f.id, f.url, f.feed_type, f.is_active, s.name as source_name, s.domain, s.tier
     from feeds f
     left join sources s on s.id = f.source_id
     order by f.created_at asc`
  );

  if (existing.rows.length > 0) {
    const replacements: Record<string, { url: string; feedType: "scrape" }> = {
      "https://www.edsurge.com/news/rss.xml": {
        url: "https://www.edsurge.com/news",
        feedType: "scrape"
      },
      "https://www.k12dive.com/feeds/news/": {
        url: "https://www.k12dive.com/",
        feedType: "scrape"
      },
      "https://www.edutopia.org/rss.xml": {
        url: "https://www.edutopia.org/",
        feedType: "scrape"
      },
      "https://www.brookings.edu/topic/education/feed/": {
        url: "https://www.brookings.edu/topic/education/",
        feedType: "scrape"
      },
      "https://www.rand.org/topics/education.feed.xml": {
        url: "https://www.rand.org/topics/education-and-literacy.html",
        feedType: "scrape"
      },
      "https://www.kqed.org/education/feed": {
        url: "https://www.kqed.org/education",
        feedType: "scrape"
      },
      "https://www.chalkbeat.org/feed/": {
        url: "https://www.chalkbeat.org/",
        feedType: "scrape"
      }
    };

    for (const row of existing.rows) {
      const replacement = replacements[row.url as string];
      if (!replacement) continue;
      await pool.query(
        `update feeds
         set url = $2,
             feed_type = $3,
             updated_at = now()
         where id = $1`,
        [row.id, replacement.url, replacement.feedType]
      );
      row.url = replacement.url;
      row.feed_type = replacement.feedType;
    }

    return existing.rows
      .filter((row) => row.is_active)
      .map((row) => ({
        id: row.id as string,
        url: row.url as string,
        sourceName: (row.source_name as string) ?? "Unknown",
        domain: (row.domain as string) ?? "",
        tier: (row.tier as "A" | "B" | "C" | "unknown") ?? "unknown",
        isActive: row.is_active as boolean,
        feedType: (row.feed_type as "rss" | "discovery" | "scrape") ?? "rss"
      }));
  }

  const defaults = getDefaultFeeds(7);
  for (const feed of defaults) {
    const sourceId = await ensureSource(feed.sourceName, feed.domain, feed.tier);
    if (!sourceId) continue;
    await ensureFeed(feed.url, sourceId, feed.feedType ?? "rss");
  }

  const seeded = await pool.query(
    `select f.id, f.url, f.feed_type, f.is_active, s.name as source_name, s.domain, s.tier
     from feeds f
     left join sources s on s.id = f.source_id
     order by f.created_at asc`
  );

  return seeded.rows
    .filter((row) => row.is_active)
    .map((row) => ({
      id: row.id as string,
      url: row.url as string,
      sourceName: (row.source_name as string) ?? "Unknown",
      domain: (row.domain as string) ?? "",
      tier: (row.tier as "A" | "B" | "C" | "unknown") ?? "unknown",
      isActive: row.is_active as boolean,
      feedType: (row.feed_type as "rss" | "discovery" | "scrape") ?? "rss"
    }));
}

export async function ingestFeeds(): Promise<IngestResult> {
  const feeds = await loadFeedRegistry();
  let fetchedItems = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let unresolvedGoogleSkipped = 0;
  let parseFailures = 0;
  let nonArticleBlocked = 0;
  const scrapeSummaryLimit = 40;
  let scrapeSummaries = 0;

  for (const feed of feeds) {
    let parsed;
    try {
      if (feed.feedType === "scrape") {
        parsed = await parseScrapeFeed(feed.url, feed.domain);
      } else {
        parsed = await parser.parseURL(feed.url);
      }
      if (feed.id) {
        await pool.query(
          `update feeds
           set last_success_at = now(),
               last_error = null,
               failure_count = 0
           where id = $1`,
          [feed.id]
        );
      }
    } catch (error) {
      parseFailures += 1;
      console.error(
        `[ingest] failed to parse feed ${feed.url}: ${error instanceof Error ? error.message : String(error)}`
      );
      if (feed.id) {
        await pool.query(
          `update feeds
           set last_error = $2,
               failure_count = failure_count + 1
           where id = $1`,
          [feed.id, error instanceof Error ? error.message : String(error)]
        );
      }
      continue;
    }

    for (const item of parsed.items.slice(0, MAX_ITEMS_PER_FEED)) {
      fetchedItems += 1;
      const rawItem = item as {
        contentSnippet?: string;
        content?: string;
        isoDate?: string;
        pubDate?: string;
      };

      const rawTitle = item.title ?? "";
      const title = normalizeTitleCase(cleanTitle(rawTitle));
      const link = item.link ?? "";
      if (!link || !title) {
        skipped += 1;
        continue;
      }

      const resolvedUrl = await resolveGoogleNewsUrl(link);
      const normalizedUrl = normalizeUrl(resolvedUrl);
      if (!normalizedUrl) {
        skipped += 1;
        continue;
      }
      if (feed.domain === "news.google.com" && isUnresolvedGoogleNewsUrl(normalizedUrl)) {
        skipped += 1;
        unresolvedGoogleSkipped += 1;
        continue;
      }

      if (isJobListing(title, normalizedUrl)) {
        skipped += 1;
        continue;
      }

      const sourceDomain =
        feed.domain === "news.google.com" ? getDomain(normalizedUrl) : feed.domain;
      if (!sourceDomain) {
        skipped += 1;
        continue;
      }

      const sourceName =
        feed.domain === "news.google.com" ? sourceDomain : feed.sourceName;

      const sourceId = await ensureSource(sourceName, sourceDomain, feed.tier);
      if (!sourceId) {
        skipped += 1;
        continue;
      }
      const summaryCandidates: SummaryCandidate[] = [];
      addSummaryCandidate(
        summaryCandidates,
        "rss",
        rawItem.contentSnippet ?? rawItem.content ?? "",
        title
      );
      const hasWeakSummaryCandidates =
        summaryCandidates.length === 0 ||
        summaryCandidates.every((candidate) => candidate.score < 0.62);
      const shouldTryScrape =
        Boolean(process.env.FIRECRAWL_API_KEY) &&
        scrapeSummaries < scrapeSummaryLimit &&
        (feed.feedType === "scrape" || hasWeakSummaryCandidates);
      if (shouldTryScrape) {
        try {
          const scraped = await fetchArticleSummary(normalizedUrl);
          const added = addSummaryCandidate(summaryCandidates, "scrape", scraped, title);
          if (added) {
            scrapeSummaries += 1;
          }
        } catch (error) {
          console.error(
            `[ingest] failed to fetch article summary ${normalizedUrl}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      if (summaryCandidates.length === 0) {
        addSummaryCandidate(
          summaryCandidates,
          "fallback",
          createFallbackSummaryFromTitle(title),
          title
        );
      }
      const summaryDecision = deterministicSummaryDecision(summaryCandidates);
      const summary = summaryDecision?.summary ?? createFallbackSummaryFromTitle(title);
      if (!isUSOnlyStory(title, summary)) {
        skipped += 1;
        continue;
      }
      const quality = classifyArticleQuality({
        url: normalizedUrl,
        title,
        summary
      });
      if (quality.label === "non_article") {
        skipped += 1;
        nonArticleBlocked += 1;
        continue;
      }
      const publishedAt = rawItem.isoDate
        ? new Date(rawItem.isoDate)
        : rawItem.pubDate
          ? new Date(rawItem.pubDate)
          : null;
      const candidatePayload = JSON.stringify(
        summaryCandidates.map((candidate) => ({
          source: candidate.source,
          score: candidate.score,
          text: candidate.text
        }))
      );
      const summaryChoiceSource = summaryDecision?.source ?? null;
      const summaryChoiceMethod = summaryDecision?.method ?? "deterministic";
      const summaryChoiceConfidence = summaryDecision?.confidence ?? 0;
      const summaryChoiceReasons = summaryDecision?.reasons ?? ["no_candidate"];

      const result = await pool.query(
        `insert into articles (
           source_id,
           url,
           title,
           summary,
           quality_label,
           quality_score,
           quality_reasons,
           quality_checked_at,
           summary_choice_source,
           summary_choice_method,
           summary_choice_confidence,
           summary_choice_reasons,
           summary_choice_checked_at,
           summary_candidates,
           published_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11, now(), $12::jsonb, $13)
         on conflict (url)
         do update set
           title = excluded.title,
           summary = case
             when excluded.summary is null or length(trim(excluded.summary)) = 0 then articles.summary
             when articles.summary is null or length(trim(articles.summary)) = 0 then excluded.summary
             when length(trim(articles.summary)) < 40 then excluded.summary
             when articles.summary ~* '(sign up|subscribe|newsletter|republish|sponsor|advertis|getty images|base64|streamlinehq|share on|follow us|facebook|twitter|instagram|linkedin)' then excluded.summary
             when articles.summary ~* '!\\[[^\\]]*\\]\\(' then excluded.summary
             when articles.summary ~* '(contact.*contact|downloads?.*downloads?|share.*share.*share)' then excluded.summary
             when length(excluded.summary) > length(articles.summary) then excluded.summary
             else articles.summary
           end,
           quality_label = excluded.quality_label,
           quality_score = excluded.quality_score,
           quality_reasons = excluded.quality_reasons,
           quality_checked_at = now(),
           summary_choice_source = excluded.summary_choice_source,
           summary_choice_method = excluded.summary_choice_method,
           summary_choice_confidence = excluded.summary_choice_confidence,
           summary_choice_reasons = excluded.summary_choice_reasons,
           summary_choice_checked_at = now(),
           summary_candidates = excluded.summary_candidates,
           published_at = excluded.published_at,
           updated_at = now()
         returning (xmax = 0) as inserted`,
        [
          sourceId,
          normalizedUrl,
          title,
          summary,
          quality.label,
          quality.score,
          quality.reasons,
          summaryChoiceSource,
          summaryChoiceMethod,
          summaryChoiceConfidence,
          summaryChoiceReasons,
          candidatePayload,
          publishedAt
        ]
      );

      if (result.rows[0]?.inserted) {
        inserted += 1;
      } else {
        updated += 1;
      }
    }
  }

  const qualityScan = await classifyRecentArticles(3000);
  const grouped = await groupUngroupedArticles();
  const summaryFill = await fillStorySummaries(100, undefined, true, 20);

  return {
    feeds: feeds.length,
    fetchedItems,
    inserted,
    updated,
    skipped,
    unresolvedGoogleSkipped,
    grouped,
    parseFailures,
    qualityChecked: qualityScan.qualityChecked,
    nonArticleBlocked,
    nonArticleFlagged: qualityScan.nonArticleFlagged,
    summariesEnriched: summaryFill.enriched,
    summaryAdjudicatedAI: summaryFill.adjudicatedAI,
    summaryAdjudicatedDeterministic: summaryFill.adjudicatedDeterministic,
    summaryGeneratedLLM: summaryFill.llmGenerated,
    summaryRejected: summaryFill.rejected
  };
}
