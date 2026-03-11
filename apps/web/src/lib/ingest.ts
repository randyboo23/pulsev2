import Parser from "rss-parser";
import { pool } from "./db";
import { getDefaultFeeds } from "./feeds";
import { TRUSTED_SITES, SOURCE_TIERS } from "@pulse/core";
import {
  groupUngroupedArticles,
  mergeSimilarStories,
  splitMixedStories,
  evaluateStoryMergeDecision
} from "./grouping";
import {
  getTopStories,
  inferGeoStateFromTitle,
  inferGeoTopicFromTitle,
  refreshHomepageRanks
} from "./stories";
import { isLikelyNonStoryTitle, isLikelyNonStoryUrl } from "./story-quality";
import {
  hasStrictK12TopicSignal,
  isClearlyOffTopicForK12
} from "./k12-relevance";
import { sendSmtpTextEmail } from "./smtp";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "PulseK12/1.0 (+https://pulsek12.com)"
  }
});

let anthropicAvailable: boolean | null = null;
let firecrawlBackoffUntil = 0;

const FIRECRAWL_BACKOFF_MS = 15 * 60 * 1000;
const FIRECRAWL_DAILY_BUDGET = Number(process.env.FIRECRAWL_DAILY_BUDGET ?? "90");
const FIRECRAWL_PRIORITY_STORY_LIMIT = Number(process.env.FIRECRAWL_PRIORITY_STORY_LIMIT ?? "12");
const INGEST_ALERT_MERGED_STORIES = Number(process.env.INGEST_ALERT_MERGED_STORIES ?? "25");
const INGEST_ALERT_MERGE_TO_GROUPED_RATIO = Number(process.env.INGEST_ALERT_MERGE_TO_GROUPED_RATIO ?? "0.65");
const INGEST_ALERT_MIXED_OUTLIERS = Number(process.env.INGEST_ALERT_MIXED_OUTLIERS ?? "1");
const INGEST_ALERT_SPLIT_STORIES = Number(process.env.INGEST_ALERT_SPLIT_STORIES ?? "1");
const INGEST_ALERT_TOP_STORY_DUPLICATE_PAIRS = envBoundedInt(
  "INGEST_ALERT_TOP_STORY_DUPLICATE_PAIRS",
  1,
  1,
  20
);

function envBoundedInt(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name] ?? String(fallback));
  const parsed = Number.isFinite(raw) ? Math.floor(raw) : fallback;
  return Math.max(min, Math.min(max, parsed));
}

function envBoundedFloat(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name] ?? String(fallback));
  const parsed = Number.isFinite(raw) ? raw : fallback;
  return Math.max(min, Math.min(max, parsed));
}

const TOP_STORY_PUBLISH_GATE_LIMIT = envBoundedInt("TOP_STORY_PUBLISH_GATE_LIMIT", 10, 5, 20);
const TOP_STORY_PUBLISH_GATE_SCAN_LIMIT = envBoundedInt("TOP_STORY_PUBLISH_GATE_SCAN_LIMIT", 20, 10, 40);
const TOP_STORY_PUBLISH_GATE_MAX_PASSES = envBoundedInt("TOP_STORY_PUBLISH_GATE_MAX_PASSES", 3, 1, 6);
const TOP_STORY_PUBLISH_GATE_STATE_MISMATCH_MIN = envBoundedInt(
  "TOP_STORY_PUBLISH_GATE_STATE_MISMATCH_MIN",
  2,
  1,
  6
);
const TOP_STORY_PUBLISH_GATE_ENTITY_CONFLICT_MIN = envBoundedInt(
  "TOP_STORY_PUBLISH_GATE_ENTITY_CONFLICT_MIN",
  2,
  1,
  6
);
const TOP_STORY_PUBLISH_GATE_STATE_LIMIT = envBoundedInt("TOP_STORY_PUBLISH_GATE_STATE_LIMIT", 1, 1, 4);
const TOP_STORY_PUBLISH_GATE_STATE_OVERRIDE_SOURCE_COUNT = envBoundedInt(
  "TOP_STORY_PUBLISH_GATE_STATE_OVERRIDE_SOURCE_COUNT",
  3,
  2,
  12
);
const TOP_STORY_PUBLISH_GATE_STATE_TOPIC_LIMIT = envBoundedInt(
  "TOP_STORY_PUBLISH_GATE_STATE_TOPIC_LIMIT",
  1,
  1,
  3
);
const TOP_STORY_PUBLISH_GATE_STALE_TOP3_HOURS = envBoundedInt(
  "TOP_STORY_PUBLISH_GATE_STALE_TOP3_HOURS",
  48,
  24,
  336
);
const TOP_STORY_PUBLISH_GATE_STALE_TOP10_HOURS = envBoundedInt(
  "TOP_STORY_PUBLISH_GATE_STALE_TOP10_HOURS",
  72,
  48,
  336
);
const TOP_STORY_PREMERGE_ENABLED =
  String(process.env.TOP_STORY_PREMERGE_ENABLED ?? "true").toLowerCase() !== "false";
const TOP_STORY_PREMERGE_CANDIDATE_LIMIT = envBoundedInt(
  "TOP_STORY_PREMERGE_CANDIDATE_LIMIT",
  20,
  10,
  60
);
const TOP_STORY_PREMERGE_MAX_MERGES = envBoundedInt("TOP_STORY_PREMERGE_MAX_MERGES", 4, 0, 20);
const TOP_STORY_PREMERGE_LOOKBACK_DAYS = envBoundedInt(
  "TOP_STORY_PREMERGE_LOOKBACK_DAYS",
  10,
  2,
  45
);
const TOP_STORY_PREMERGE_SIMILARITY = envBoundedFloat(
  "TOP_STORY_PREMERGE_SIMILARITY",
  0.54,
  0.45,
  0.8
);
const TOP_STORY_DUPLICATE_AUDIT_LIMIT = envBoundedInt(
  "TOP_STORY_DUPLICATE_AUDIT_LIMIT",
  10,
  5,
  20
);
const TOP_STORY_DUPLICATE_AUDIT_SIMILARITY = envBoundedFloat(
  "TOP_STORY_DUPLICATE_AUDIT_SIMILARITY",
  0.54,
  0.45,
  0.8
);
const GUARDRAIL_ALERT_EMAIL_COOLDOWN_MINUTES = envBoundedInt(
  "GUARDRAIL_ALERT_EMAIL_COOLDOWN_MINUTES",
  60,
  5,
  1_440
);
const GUARDRAIL_ALERT_EMAIL_SMTP_HOST = String(
  process.env.GUARDRAIL_ALERT_EMAIL_SMTP_HOST ?? "smtp.gmail.com"
).trim();
const GUARDRAIL_ALERT_EMAIL_SMTP_PORT = envBoundedInt(
  "GUARDRAIL_ALERT_EMAIL_SMTP_PORT",
  465,
  1,
  65_535
);
const GUARDRAIL_ALERT_EMAIL_SMTP_USER = String(process.env.GUARDRAIL_ALERT_EMAIL_SMTP_USER ?? "").trim();
const GUARDRAIL_ALERT_EMAIL_SMTP_PASS = String(process.env.GUARDRAIL_ALERT_EMAIL_SMTP_PASS ?? "")
  .replace(/\s+/g, "")
  .trim();
const GUARDRAIL_ALERT_EMAIL_TO = String(process.env.GUARDRAIL_ALERT_EMAIL_TO ?? "")
  .split(/[;,]/)
  .map((value) => value.trim())
  .filter(Boolean);
const GUARDRAIL_ALERT_EMAIL_FROM = String(
  process.env.GUARDRAIL_ALERT_EMAIL_FROM || GUARDRAIL_ALERT_EMAIL_SMTP_USER
).trim();
const GUARDRAIL_ALERT_EMAIL_EHLO = String(process.env.GUARDRAIL_ALERT_EMAIL_EHLO ?? "pulsek12.com").trim();
const GUARDRAIL_ALERT_SITE_URL = String(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://pulsek12.com"
).replace(/\/+$/, "");
const LINKEDIN_TOP_STORY_EMAIL_ENABLED =
  String(process.env.LINKEDIN_TOP_STORY_EMAIL_ENABLED ?? "true").toLowerCase() !== "false";
const LINKEDIN_TOP_STORY_EMAIL_MIN_SOURCES = envBoundedInt(
  "LINKEDIN_TOP_STORY_EMAIL_MIN_SOURCES",
  3,
  2,
  20
);
const LINKEDIN_TOP_STORY_EMAIL_RANK_LIMIT = envBoundedInt(
  "LINKEDIN_TOP_STORY_EMAIL_RANK_LIMIT",
  10,
  1,
  20
);
const LINKEDIN_TOP_STORY_EMAIL_MAX_SOURCE_NAMES = envBoundedInt(
  "LINKEDIN_TOP_STORY_EMAIL_MAX_SOURCE_NAMES",
  3,
  2,
  6
);

const TOP_SLOT_ROUNDUP_PATTERNS = [
  /\bnumber of the week\b/i,
  /\bweek in review\b/i,
  /\broundup\b/i,
  /\ba look at\b/i,
  /\bwhat to know\b/i
];

let lastFirecrawlBudgetWarningDay = "";

type IngestGroupingGuardrailMetrics = {
  grouped: number;
  mergedStories: number;
  mixedStoryOutliers: number;
  mixedStoriesSplit: number;
};

function groupingGuardrailAlerts(metrics: IngestGroupingGuardrailMetrics) {
  const alerts: string[] = [];
  const groupedDenominator = Math.max(1, metrics.grouped);
  const mergeToGroupedRatio = metrics.mergedStories / groupedDenominator;

  if (Number.isFinite(INGEST_ALERT_MERGED_STORIES) && metrics.mergedStories >= INGEST_ALERT_MERGED_STORIES) {
    alerts.push(`high_merge_count:${metrics.mergedStories}`);
  }

  if (
    Number.isFinite(INGEST_ALERT_MERGE_TO_GROUPED_RATIO) &&
    metrics.grouped >= 5 &&
    mergeToGroupedRatio >= INGEST_ALERT_MERGE_TO_GROUPED_RATIO
  ) {
    alerts.push(`high_merge_ratio:${mergeToGroupedRatio.toFixed(2)}`);
  }

  if (Number.isFinite(INGEST_ALERT_MIXED_OUTLIERS) && metrics.mixedStoryOutliers >= INGEST_ALERT_MIXED_OUTLIERS) {
    alerts.push(`mixed_outliers:${metrics.mixedStoryOutliers}`);
  }

  if (Number.isFinite(INGEST_ALERT_SPLIT_STORIES) && metrics.mixedStoriesSplit >= INGEST_ALERT_SPLIT_STORIES) {
    alerts.push(`mixed_splits:${metrics.mixedStoriesSplit}`);
  }

  return alerts;
}

function isFirecrawlBackoffActive() {
  return firecrawlBackoffUntil > Date.now();
}

function canUseFirecrawl() {
  return Boolean(process.env.FIRECRAWL_API_KEY) && !isFirecrawlBackoffActive();
}

function isFirecrawlQuotaLikeError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    /\bFirecrawl\s+(402|429)\b/i.test(error.message) ||
    /\bfirecrawl_backoff_active\b/i.test(error.message) ||
    /\bfirecrawl_daily_budget_exhausted\b/i.test(error.message)
  );
}

async function getFirecrawlCallsUsedToday() {
  const result = await pool.query(
    `select coalesce(sum(coalesce((detail->>'calls')::int, 1)), 0)::int as calls
     from admin_events
     where event_type = 'firecrawl_usage'
       and created_at >= date_trunc('day', now())`
  );
  return Number(result.rows[0]?.calls ?? 0);
}

async function hasFirecrawlBudgetRemaining() {
  if (!Number.isFinite(FIRECRAWL_DAILY_BUDGET) || FIRECRAWL_DAILY_BUDGET <= 0) {
    return false;
  }

  const usedToday = await getFirecrawlCallsUsedToday();
  const remaining = FIRECRAWL_DAILY_BUDGET - usedToday;
  if (remaining > 0) return true;

  const dayKey = new Date().toISOString().slice(0, 10);
  if (lastFirecrawlBudgetWarningDay !== dayKey) {
    lastFirecrawlBudgetWarningDay = dayKey;
    console.warn(
      `[ingest] Firecrawl daily budget reached (${usedToday}/${FIRECRAWL_DAILY_BUDGET}); continuing with free scrape methods`
    );
  }
  return false;
}

async function recordFirecrawlUsage() {
  await pool.query(
    `insert into admin_events (event_type, detail)
     values ('firecrawl_usage', jsonb_build_object('calls', 1))`
  );
}

async function recordIngestGuardrailAlert(detail: Record<string, unknown>) {
  try {
    await pool.query(
      `insert into admin_events (event_type, detail)
       values ('ingest_guardrail_alert', $1::jsonb)`,
      [JSON.stringify(detail)]
    );
  } catch (error) {
    console.error(
      `[ingest] failed to record guardrail alert event: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function recordGuardrailEmailEvent(detail: Record<string, unknown>) {
  try {
    await pool.query(
      `insert into admin_events (event_type, detail)
       values ('ingest_guardrail_email', $1::jsonb)`,
      [JSON.stringify(detail)]
    );
  } catch (error) {
    console.error(
      `[ingest] failed to record guardrail email event: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function recordTopStoryPublishGateEvent(detail: Record<string, unknown>) {
  try {
    await pool.query(
      `insert into admin_events (event_type, detail)
       values ('ingest_top_story_gate', $1::jsonb)`,
      [JSON.stringify(detail)]
    );
  } catch (error) {
    console.error(
      `[ingest] failed to record top-story gate event: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function parseFeedViaHttp(feedUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(feedUrl, {
      headers: {
        "User-Agent": "PulseK12/1.0 (+https://pulsek12.com)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Status code ${response.status}`);
    }

    const xml = await response.text();
    return parser.parseString(xml);
  } finally {
    clearTimeout(timeout);
  }
}

/** Extract JSON from a response that may include markdown fences or preamble. */
function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
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

const MAX_ITEMS_PER_FEED = 100;
const MAX_ITEMS_PER_DISCOVERY_FEED = envBoundedInt(
  "INGEST_MAX_DISCOVERY_ITEMS_PER_FEED",
  40,
  10,
  100
);
const AP_WIRE_MIN_RELEVANCE_SCORE = 0.5;
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
  mergedStories: number;
  mixedStoryCandidates: number;
  mixedStoryOutliers: number;
  mixedStoriesSplit: number;
  guardrailAlerts: string[];
  parseFailures: number;
  qualityChecked: number;
  nonArticleBlocked: number;
  nonArticleFlagged: number;
  summariesEnriched: number;
  summaryAdjudicatedAI: number;
  summaryAdjudicatedDeterministic: number;
  summaryGeneratedLLM: number;
  summaryRejected: number;
  homepageRanked: number;
  publishGateChecked: number;
  publishGateFlagged: number;
  publishGateDemoted: number;
  topStoryDuplicatePairs: number;
  relevanceChecked: number;
  relevanceRejected: number;
};

type TopStoryPublishGateDetail = {
  storyId: string;
  rank: number;
  title: string;
  status: string | null | undefined;
  state: string | null;
  topic: string;
  articleCount: number;
  sourceCount: number;
  recentCount: number;
  hoursSinceLatest: number;
  stateMismatchCount: number;
  entityConflictCount: number;
  reasons: string[];
};

type TopStoryPublishGateResult = {
  checked: number;
  flagged: number;
  demoted: number;
  details: TopStoryPublishGateDetail[];
};

type TopStoryPublishGatePassResult = TopStoryPublishGateResult & {
  demotedStoryIds: string[];
};

type ArticleQualityLabel = "article" | "non_article" | "uncertain";

type ArticleQualityDecision = {
  label: ArticleQualityLabel;
  score: number;
  reasons: string[];
};

type ContentRelevanceDecision = {
  relevant: boolean;
  score: number;
  category: string;
  reason: string;
};

async function classifyContentRelevance(
  title: string,
  summary: string
): Promise<ContentRelevanceDecision | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (anthropicAvailable === false) return null;

  const prompt = `You are an editorial filter for a K-12 education news aggregator serving superintendents, principals, and district administrators.

Evaluate whether this article is editorially relevant for K-12 education leadership.

Title: ${title}
Summary: ${summary.slice(0, 500)}

RELEVANT topics: policy/legislation, district operations, school board decisions, budget/funding, safety incidents, superintendent/principal news, EdTech procurement, assessment/accountability, workforce/staffing, curriculum adoption decisions, state/federal education policy, school closures/openings.

NOT RELEVANT: personal teacher blogs or "my classroom" posts, individual classroom activities without systemic impact (e.g. running a student club, classroom decoration, lesson ideas), gardening/cooking for teachers, how-to listicles for individual teachers, first-person teacher narratives without policy implications, commercial product announcements without policy context, opinion pieces from non-experts, international education without US impact, general parenting advice, college/university news (unless K-12 pipeline), entertainment, sports, event listings/webinars/info sessions, generic crime coverage without a school-system or policy angle, and non-education politics/government stories. Treat isolated words like "school", "principal", or "teacher" as weak evidence on their own.

Respond with ONLY valid JSON:
{"relevant":true/false,"score":0.0-1.0,"category":"policy|district_ops|curriculum|safety|edtech|workforce|off_topic|personal|commercial","reason":"brief explanation"}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 100,
        temperature: 0,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        anthropicAvailable = false;
      }
      return null;
    }

    anthropicAvailable = true;
    const payload = await response.json();
    const text = payload?.content?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(extractJson(text));
    return {
      relevant: Boolean(parsed.relevant),
      score: Number(parsed.score) || 0,
      category: String(parsed.category || "off_topic"),
      reason: String(parsed.reason || "")
    };
  } catch {
    return null;
  }
}

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
  /\/events?(?:\/|$)/i,
  /\/tags?(?:\/|$)/i,
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
  const hasNonStoryUrlPath = isLikelyNonStoryUrl(params.url);
  const hasArticlePathHint = ARTICLE_PATH_HINT_PATTERNS.some((pattern) => pattern.test(pathname));
  const hasNonStoryTitle = isLikelyNonStoryTitle(title);
  const hasBiographyText = BIOGRAPHY_TEXT_PATTERNS.some((pattern) => pattern.test(text));
  const hasPromoText = PROMOTIONAL_TEXT_PATTERNS.some((pattern) => pattern.test(text));
  const hasSectionTitle = looksLikeSectionTitle(title);
  const hasSectionIndexPath = looksLikeSectionIndexPath(pathname);
  const personNameTitle = looksLikePersonName(title);

  if (hasNonArticlePath) {
    score -= 0.55;
    reasons.push("non_article_url_path");
  }
  if (hasNonStoryUrlPath) {
    score -= 0.6;
    reasons.push("non_story_url_path");
  }
  if (hasNonStoryTitle) {
    score -= 0.65;
    reasons.push("non_story_title_pattern");
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

  // Detect personal/classroom blog posts and community meta-posts
  const personalBlogPatterns = [
    /\b(my classroom|my students|my school|in my class)\b/i,
    /\b(I teach|I use|I created|I started|I love|I decided|I tried)\b/i,
    /\b(here are \d+ ways|tips for teachers|how I)\b/i,
    /\brunning (a|your|student) .*\bclub\b/i,
    /\b(teacher tip|classroom hack|lesson idea|activity idea)\b/i,
    /\b(give feedback|share your thoughts|take our survey|join us|sign up for)\b/i,
  ];
  const personalHits = personalBlogPatterns.filter((p) => p.test(text)).length;
  if (personalHits >= 2) {
    score -= 0.35;
    reasons.push("personal_blog_pattern");
  } else if (personalHits === 1) {
    score -= 0.15;
    reasons.push("personal_blog_hint");
  }

  if (summary.length >= 80) {
    score += 0.08;
  }
  if (title.length >= 32 && !personNameTitle) {
    score += 0.08;
  }

  if ((hasNonArticlePath || hasNonStoryUrlPath || hasNonStoryTitle) && !hasArticlePathHint) {
    return {
      label: "non_article",
      score: 0.06,
      reasons: Array.from(new Set(reasons))
    };
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
  // Skip normalization only if title looks properly title-cased:
  // multiple words starting with uppercase (not just sentence case)
  const words = trimmed.split(/\s+/);
  const upperStartCount = words.filter((w) => /^[A-Z]/.test(w)).length;
  if (upperStartCount >= Math.max(2, words.length * 0.4)) return trimmed;

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

async function fetchHtmlViaHttp(url: string, maxChars = 200_000): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PulseBot/1.0; +https://pulse-k12.com)",
        Accept: "text/html"
      },
      redirect: "follow",
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) return "";

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return "";

    const text = await response.text();
    return text.slice(0, maxChars);
  } catch {
    return "";
  }
}

/**
 * Free scrape: plain HTTP fetch + regex extraction. No API credits used.
 * Returns extracted summary text, or empty string on failure.
 */
async function freeArticleScrape(url: string): Promise<string> {
  try {
    const html = await fetchHtmlViaHttp(url, 200_000);
    if (!html) return "";

    // Try meta description first (og:description, twitter:description, etc.)
    const meta = extractMetaDescription(html);
    if (meta && meta.length >= 40) return meta;

    // Try first meaningful <p> in article body
    const articleMatch = html.match(
      /<article[^>]*>([\s\S]*?)<\/article>/i
    );
    const searchHtml = articleMatch?.[1] ?? html;
    const paragraphs = searchHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
    for (const p of paragraphs.slice(0, 5)) {
      const text = sanitizeSummary(
        decodeEntities(stripTags(p.replace(/<[^>]*>/g, "")))
      );
      if (text && text.length >= 40) return text;
    }

    // Fall back to meta even if short
    if (meta) return meta;
    return "";
  } catch {
    return "";
  }
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
    .slice(0, 6000);
  const prompt = `You are writing a concise brief for US K-12 education leaders (superintendents, principals, district admins).

Title: ${title}

Source text:
${trimmed}

Write 1-2 sentences (max 60 words). State the key fact or development first. Include who (which district, state, or organization) and what specifically happened. Do not start with "A new report..." or "According to..." or "New coverage...". Use only the source text. Avoid boilerplate (subscribe, republish, sponsor, ads, navigation). Avoid hype or speculation. If this article is about a personal experience or individual teacher activity without systemic implications, respond with just the word IRRELEVANT.`;

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
    const trimmedResult = text.trim();
    if (trimmedResult.toUpperCase() === "IRRELEVANT") return "";
    return trimmedResult;
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

  const bestScore = Math.max(...candidates.map((c) => c.score));
  if (allowAI && (candidates.length > 1 || bestScore < 0.7)) {
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
  const tierANational = SOURCE_TIERS.tierA.national as readonly string[];
  const tierBDomains = SOURCE_TIERS.tierB.domains as readonly string[];
  const tierCDomains = SOURCE_TIERS.tierC.domains as readonly string[];
  const tier =
    tierHint !== "unknown"
      ? tierHint
      : tierALocalJournalism.includes(domain) ||
          tierAStateEducation.includes(domain) ||
          tierANational.includes(domain) ||
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

  let weight = isTrusted ? 1.2 : tier === "A" ? 1.1 : tier === "B" ? 1.0 : 0.7;
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
  if (isFirecrawlBackoffActive()) {
    throw new Error("firecrawl_backoff_active");
  }
  if (!(await hasFirecrawlBudgetRemaining())) {
    throw new Error("firecrawl_daily_budget_exhausted");
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
    if (response.status === 402 || response.status === 429) {
      firecrawlBackoffUntil = Date.now() + FIRECRAWL_BACKOFF_MS;
    }
    throw new Error(`Firecrawl ${response.status}`);
  }
  const payload = await response.json();
  if (!payload?.success) {
    throw new Error(payload?.error ?? "Firecrawl failed");
  }
  await recordFirecrawlUsage();
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
  const freeHtml = await fetchHtmlViaHttp(url, 300_000);
  const freeLinks = freeHtml ? extractLinksFromHtml(freeHtml, url, domain).slice(0, MAX_ITEMS_PER_FEED) : [];
  if (freeLinks.length > 0) {
    return {
      items: freeLinks.map((link) => ({
        title: link.title,
        link: link.url
      }))
    };
  }

  if (!canUseFirecrawl() || !(await hasFirecrawlBudgetRemaining())) {
    return { items: [] };
  }

  try {
    const html = await fetchFirecrawlHtml(url);
    const links = extractLinksFromHtml(html, url, domain).slice(0, MAX_ITEMS_PER_FEED);
    return {
      items: links.map((link) => ({
        title: link.title,
        link: link.url
      }))
    };
  } catch (error) {
    if (isFirecrawlQuotaLikeError(error)) {
      return { items: [] };
    }
    throw error;
  }
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
    or s.summary ~* '^(coverage|reporting)\\s+(is\\s+)?(converging on|focused on|centered on|now centers on)\\b'
    or s.summary ~* '^(new coverage highlights|recent reporting points to|new reporting points to|districts are now tracking|budget coverage now centers on|new (finance|budget) reporting highlights|district budget attention is shifting toward|policy coverage is focused on|legal and policy reporting now centers on|new governance reporting highlights|education reporting is focused on|classroom-focused coverage now highlights|new school reporting points to)'
    or s.summary ~* 'why it matters:\\s*(district leaders and educators may need to adjust policy,\\s*staffing,\\s*or classroom practice|school systems may need to revisit planning,\\s*staffing,\\s*or implementation decisions|this could influence district priorities and how schools execute day-to-day operations)'
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
  const fetchLimit = Math.min(limit, 20);
  const canUseAI = allowAI && Boolean(process.env.ANTHROPIC_API_KEY);
  const priorityStoryLimit = Math.max(0, Math.min(fetchLimit, FIRECRAWL_PRIORITY_STORY_LIMIT));

  for (const [rowIndex, row] of result.rows.entries()) {
    const summaryTitle = (row.article_title as string | null) ?? (row.story_title as string) ?? "";
    const candidates: SummaryCandidate[] = [];
    addSummaryCandidate(candidates, "existing", row.summary as string | null, summaryTitle);

    const existingSummary = (row.summary as string | null) ?? "";
    const summaryIsMissingOrGarbage =
      existingSummary.trim().length < 40 ||
      candidates.length === 0 ||
      candidates.every((c) => c.score < 0.45);
    const isPriorityStory = rowIndex < priorityStoryLimit;
    let triedFirecrawl = false;

    // Quality-first for top stories: try Firecrawl before free scrape (within budget/caps).
    if (summaryIsMissingOrGarbage) {
      if (isPriorityStory && fetched < fetchLimit && canUseFirecrawl()) {
        triedFirecrawl = true;
        try {
          const scraped = await fetchArticleSummary(row.url as string);
          const added = addSummaryCandidate(candidates, "scrape", scraped, summaryTitle);
          if (added) {
            fetched += 1;
          }
        } catch (error) {
          if (!isFirecrawlQuotaLikeError(error)) {
            console.error(
              `[ingest] failed to enrich priority story summary ${row.url}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }

      // Free HTTP scrape fallback (no API credits)
      const stillNeedsFreeScrape = candidates.every((c) => c.score < 0.45);
      if (stillNeedsFreeScrape) {
        try {
          const freeText = await freeArticleScrape(row.url as string);
          addSummaryCandidate(candidates, "scrape", freeText, summaryTitle);
        } catch {
          // Free scrape failed silently — will try Firecrawl fallback next
        }
      }
    }

    // Non-priority fallback: only use Firecrawl if free scrape still didn't produce a good result.
    const stillMissing =
      summaryIsMissingOrGarbage &&
      candidates.every((c) => c.score < 0.45);
    if (
      stillMissing &&
      !triedFirecrawl &&
      fetched < fetchLimit &&
      canUseFirecrawl() &&
      (await hasFirecrawlBudgetRemaining())
    ) {
      try {
        const scraped = await fetchArticleSummary(row.url as string);
        const added = addSummaryCandidate(candidates, "scrape", scraped, summaryTitle);
        if (added) {
          fetched += 1;
        }
      } catch (error) {
        if (!isFirecrawlQuotaLikeError(error)) {
          console.error(
            `[ingest] failed to enrich story summary ${row.url}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
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
        // Try free scrape for LLM context before using Firecrawl
        let markdown = await freeArticleScrape(row.url as string);
        if (markdown.length < 200 && canUseFirecrawl() && (await hasFirecrawlBudgetRemaining())) {
          markdown = await fetchArticleMarkdown(row.url as string);
        }
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
        if (!isFirecrawlQuotaLikeError(error)) {
          console.error(
            `[ingest] failed to generate summary ${row.url}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
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
  }

  const defaults = getDefaultFeeds(7);
  const existingUrls = new Set(existing.rows.map((row) => String(row.url ?? "")));
  for (const feed of defaults) {
    if (existingUrls.has(feed.url)) continue;
    const sourceId = await ensureSource(feed.sourceName, feed.domain, feed.tier);
    if (!sourceId) continue;
    await ensureFeed(feed.url, sourceId, feed.feedType ?? "rss");
    existingUrls.add(feed.url);
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

async function runTopStoriesPublishGatePass(): Promise<TopStoryPublishGatePassResult> {
  const publishLimit = TOP_STORY_PUBLISH_GATE_LIMIT;
  const scanLimit = Math.max(publishLimit, TOP_STORY_PUBLISH_GATE_SCAN_LIMIT);
  const candidates = await getTopStories(scanLimit, undefined, {
    useAiRerank: true,
    useStoredRank: false
  });
  const gateStories = candidates
    .filter((story) => story.status !== "hidden")
    .slice(0, publishLimit);

  if (gateStories.length === 0) {
    return { checked: 0, flagged: 0, demoted: 0, details: [], demotedStoryIds: [] };
  }

  const storyIds = gateStories.map((story) => story.id);
  const storyArticles = await pool.query(
    `select sa.story_id, a.title
     from story_articles sa
     join articles a on a.id = sa.article_id
     where sa.story_id = any($1::uuid[])
       and coalesce(a.quality_label, 'unknown') <> 'non_article'
     order by coalesce(a.published_at, a.fetched_at) desc`,
    [storyIds]
  );

  const articleTitlesByStory = new Map<string, string[]>();
  for (const row of storyArticles.rows) {
    const storyId = String(row.story_id ?? "");
    if (!storyId) continue;
    const title = String(row.title ?? "").trim();
    if (!title) continue;
    const bucket = articleTitlesByStory.get(storyId) ?? [];
    bucket.push(title);
    articleTitlesByStory.set(storyId, bucket);
  }

  const flaggedByStoryId = new Map<string, TopStoryPublishGateDetail>();
  const now = Date.now();
  const ensureDetail = (params: {
    storyId: string;
    rank: number;
    title: string;
    status: string | null | undefined;
    state: string | null;
    topic: string;
    articleCount: number;
    sourceCount: number;
    recentCount: number;
    hoursSinceLatest: number;
    stateMismatchCount: number;
    entityConflictCount: number;
  }) => {
    const existing = flaggedByStoryId.get(params.storyId);
    if (existing) return existing;
    const detail: TopStoryPublishGateDetail = {
      storyId: params.storyId,
      rank: params.rank,
      title: params.title,
      status: params.status,
      state: params.state,
      topic: params.topic,
      articleCount: params.articleCount,
      sourceCount: params.sourceCount,
      recentCount: params.recentCount,
      hoursSinceLatest: params.hoursSinceLatest,
      stateMismatchCount: params.stateMismatchCount,
      entityConflictCount: params.entityConflictCount,
      reasons: []
    };
    flaggedByStoryId.set(params.storyId, detail);
    return detail;
  };

  for (const [index, story] of gateStories.entries()) {
    if (story.status === "pinned") continue;

    const title = String(story.editor_title ?? story.title ?? "").trim();
    if (!title) continue;
    const sourceCount = Math.max(0, Number(story.source_count ?? 0));
    const recentCount = Math.max(0, Number(story.recent_count ?? 0));
    const storyArticleCount = Math.max(0, Number(story.article_count ?? 0));
    const latestAtRaw = new Date(story.latest_at).getTime();
    const hoursSinceLatest = Number.isFinite(latestAtRaw)
      ? Math.max(0, (now - latestAtRaw) / (1000 * 60 * 60))
      : 0;

    const articleTitles = articleTitlesByStory.get(story.id) ?? [];
    let stateMismatchCount = 0;
    let entityConflictCount = 0;

    if (articleTitles.length >= 3) {
      for (const articleTitle of articleTitles) {
        const decision = evaluateStoryMergeDecision(
          {
            id: story.id,
            title,
            status: story.status,
            article_count: Math.max(1, Number(story.article_count ?? 1))
          },
          { title: articleTitle },
          0.56
        );
        if (decision.vetoReason === "state_mismatch") {
          stateMismatchCount += 1;
        } else if (decision.vetoReason === "entity_conflict") {
          entityConflictCount += 1;
        }
      }
    }

    const state = inferGeoStateFromTitle(title);
    const topic = inferGeoTopicFromTitle(title);
    const reasons: string[] = [];

    if (
      index < 10 &&
      storyArticleCount <= 1 &&
      sourceCount <= 1 &&
      recentCount === 0
    ) {
      reasons.push("thin_single_source_top_slot");
    }

    if (
      index < 10 &&
      sourceCount <= 1 &&
      TOP_SLOT_ROUNDUP_PATTERNS.some((pattern) => pattern.test(title))
    ) {
      reasons.push("roundup_single_source_top_slot");
    }

    if (
      index < 3 &&
      recentCount === 0 &&
      hoursSinceLatest >= TOP_STORY_PUBLISH_GATE_STALE_TOP3_HOURS
    ) {
      reasons.push(`stale_top3:${Math.round(hoursSinceLatest)}h`);
    } else if (
      index < 10 &&
      recentCount === 0 &&
      hoursSinceLatest >= TOP_STORY_PUBLISH_GATE_STALE_TOP10_HOURS
    ) {
      reasons.push(`stale_top10:${Math.round(hoursSinceLatest)}h`);
    }

    if (stateMismatchCount >= TOP_STORY_PUBLISH_GATE_STATE_MISMATCH_MIN) {
      reasons.push(`state_mismatch_articles:${stateMismatchCount}/${articleTitles.length}`);
    }
    if (
      articleTitles.length >= 5 &&
      entityConflictCount >= TOP_STORY_PUBLISH_GATE_ENTITY_CONFLICT_MIN
    ) {
      reasons.push(`entity_conflict_articles:${entityConflictCount}/${articleTitles.length}`);
    }

    if (reasons.length > 0) {
      const detail = ensureDetail({
        storyId: story.id,
        rank: index + 1,
        title,
        status: story.status,
        state,
        topic,
        articleCount: articleTitles.length,
        sourceCount,
        recentCount,
        hoursSinceLatest: Number(hoursSinceLatest.toFixed(1)),
        stateMismatchCount,
        entityConflictCount
      });
      for (const reason of reasons) {
        if (!detail.reasons.includes(reason)) {
          detail.reasons.push(reason);
        }
      }
    }
  }

  const stateCounts = new Map<string, number>();
  const stateTopicCounts = new Map<string, number>();
  for (const [index, story] of gateStories.entries()) {
    const title = String(story.editor_title ?? story.title ?? "").trim();
    const state = inferGeoStateFromTitle(title);
    const topic = inferGeoTopicFromTitle(title);
    if (!state) continue;

    const stateCount = stateCounts.get(state) ?? 0;
    const stateTopicKey = `${state}:${topic}`;
    const stateTopicCount = stateTopicCounts.get(stateTopicKey) ?? 0;
    const sourceCount = Math.max(0, Number(story.source_count ?? 0));
    const hasStateCoverageOverride = sourceCount >= TOP_STORY_PUBLISH_GATE_STATE_OVERRIDE_SOURCE_COUNT;
    const recentCount = Math.max(0, Number(story.recent_count ?? 0));
    const latestAtRaw = new Date(story.latest_at).getTime();
    const hoursSinceLatest = Number.isFinite(latestAtRaw)
      ? Math.max(0, (now - latestAtRaw) / (1000 * 60 * 60))
      : 0;
    const existingDetail = flaggedByStoryId.get(story.id);
    const alreadyFlagged = Boolean(existingDetail && existingDetail.reasons.length > 0);
    if (alreadyFlagged) continue;

    if (story.status !== "pinned") {
      let diversityReason: string | null = null;
      if (!hasStateCoverageOverride && stateCount >= TOP_STORY_PUBLISH_GATE_STATE_LIMIT) {
        diversityReason = `state_saturation:${state}`;
      } else if (
        !hasStateCoverageOverride &&
        topic !== "general" &&
        stateTopicCount >= TOP_STORY_PUBLISH_GATE_STATE_TOPIC_LIMIT
      ) {
        diversityReason = `state_topic_saturation:${state}:${topic}`;
      }

      if (diversityReason) {
        const created = ensureDetail({
          storyId: story.id,
          rank: index + 1,
          title,
          status: story.status,
          state,
          topic,
          articleCount: (articleTitlesByStory.get(story.id) ?? []).length,
          sourceCount,
          recentCount,
          hoursSinceLatest: Number(hoursSinceLatest.toFixed(1)),
          stateMismatchCount: 0,
          entityConflictCount: 0
        });
        if (!created.reasons.includes(diversityReason)) {
          created.reasons.push(diversityReason);
        }
        continue;
      }
    }

    stateCounts.set(state, stateCount + 1);
    if (topic !== "general") {
      stateTopicCounts.set(stateTopicKey, stateTopicCount + 1);
    }
  }

  const details = Array.from(flaggedByStoryId.values())
    .filter((detail) => detail.reasons.length > 0)
    .sort((a, b) => a.rank - b.rank);
  const idsToDemote = details.map((detail) => detail.storyId);

  let demoted = 0;
  const demotedStoryIds: string[] = [];
  if (idsToDemote.length > 0) {
    const updateResult = await pool.query(
      `update stories
       set status = 'demoted',
           updated_at = now()
       where id = any($1::uuid[])
         and coalesce(status, 'active') not in ('hidden', 'pinned', 'demoted')
       returning id`,
      [idsToDemote]
    );
    demoted = updateResult.rows.length;
    for (const row of updateResult.rows) {
      const id = String((row as { id?: string }).id ?? "").trim();
      if (id) demotedStoryIds.push(id);
    }
  }

  return {
    checked: gateStories.length,
    flagged: details.length,
    demoted,
    details,
    demotedStoryIds
  };
}

async function runTopStoriesPremerge() {
  if (!TOP_STORY_PREMERGE_ENABLED || TOP_STORY_PREMERGE_MAX_MERGES <= 0) {
    return {
      candidateStoryIds: [] as string[],
      candidates: 0,
      evaluatedPairs: 0,
      suggested: 0,
      merged: 0
    };
  }

  const scanLimit = Math.max(
    TOP_STORY_PREMERGE_CANDIDATE_LIMIT,
    TOP_STORY_PUBLISH_GATE_LIMIT,
    TOP_STORY_PUBLISH_GATE_SCAN_LIMIT
  );
  const candidates = await getTopStories(scanLimit, undefined, {
    useAiRerank: true,
    useStoredRank: false
  });
  const candidateStoryIds = candidates
    .filter((story) => story.status !== "hidden")
    .slice(0, TOP_STORY_PREMERGE_CANDIDATE_LIMIT)
    .map((story) => story.id);

  if (candidateStoryIds.length < 2) {
    return {
      candidateStoryIds,
      candidates: 0,
      evaluatedPairs: 0,
      suggested: 0,
      merged: 0
    };
  }

  const mergeResult = await mergeSimilarStories({
    storyIds: candidateStoryIds,
    lookbackDays: TOP_STORY_PREMERGE_LOOKBACK_DAYS,
    candidateLimit: candidateStoryIds.length,
    maxMerges: TOP_STORY_PREMERGE_MAX_MERGES,
    similarityThreshold: TOP_STORY_PREMERGE_SIMILARITY
  });

  if (mergeResult.merged > 0) {
    console.log(
      `[ingest] top-story premerge merged ${mergeResult.merged} stories (suggested=${mergeResult.suggested}, candidates=${candidateStoryIds.length})`
    );
  }

  return {
    candidateStoryIds,
    ...mergeResult
  };
}

async function runTopStoriesPublishGate(): Promise<TopStoryPublishGateResult> {
  const premergeResult = await runTopStoriesPremerge();
  const passSummaries: Array<{ pass: number; checked: number; flagged: number; demoted: number }> = [];
  const detailByStoryId = new Map<string, TopStoryPublishGateDetail>();
  const demotedStoryIds = new Set<string>();
  let checked = 0;

  for (let pass = 1; pass <= TOP_STORY_PUBLISH_GATE_MAX_PASSES; pass += 1) {
    const passResult = await runTopStoriesPublishGatePass();
    if (pass === 1) {
      checked = passResult.checked;
    }

    passSummaries.push({
      pass,
      checked: passResult.checked,
      flagged: passResult.flagged,
      demoted: passResult.demoted
    });

    for (const detail of passResult.details) {
      const existing = detailByStoryId.get(detail.storyId);
      if (!existing) {
        detailByStoryId.set(detail.storyId, {
          ...detail,
          reasons: [...detail.reasons]
        });
        continue;
      }

      existing.rank = Math.min(existing.rank, detail.rank);
      existing.state = existing.state ?? detail.state;
      existing.articleCount = Math.max(existing.articleCount, detail.articleCount);
      existing.sourceCount = Math.max(existing.sourceCount, detail.sourceCount);
      existing.recentCount = Math.max(existing.recentCount, detail.recentCount);
      existing.hoursSinceLatest = Math.max(existing.hoursSinceLatest, detail.hoursSinceLatest);
      existing.stateMismatchCount = Math.max(existing.stateMismatchCount, detail.stateMismatchCount);
      existing.entityConflictCount = Math.max(existing.entityConflictCount, detail.entityConflictCount);
      for (const reason of detail.reasons) {
        if (!existing.reasons.includes(reason)) {
          existing.reasons.push(reason);
        }
      }
    }

    for (const storyId of passResult.demotedStoryIds) {
      demotedStoryIds.add(storyId);
    }

    if (passResult.demoted === 0) {
      break;
    }
  }

  const details = Array.from(detailByStoryId.values()).sort((a, b) => a.rank - b.rank);
  const flagged = details.length;
  const demoted = demotedStoryIds.size;
  const publishLimit = TOP_STORY_PUBLISH_GATE_LIMIT;
  const scanLimit = Math.max(publishLimit, TOP_STORY_PUBLISH_GATE_SCAN_LIMIT);

  await recordTopStoryPublishGateEvent({
    checked,
    flagged,
    demoted,
    publishLimit,
    scanLimit,
    stateDiversity: {
      maxStoriesPerState: TOP_STORY_PUBLISH_GATE_STATE_LIMIT,
      maxStateTopicStories: TOP_STORY_PUBLISH_GATE_STATE_TOPIC_LIMIT,
      sourceOverride: TOP_STORY_PUBLISH_GATE_STATE_OVERRIDE_SOURCE_COUNT
    },
    topStoryPremerge: {
      enabled: TOP_STORY_PREMERGE_ENABLED,
      candidateLimit: TOP_STORY_PREMERGE_CANDIDATE_LIMIT,
      lookbackDays: TOP_STORY_PREMERGE_LOOKBACK_DAYS,
      similarityThreshold: TOP_STORY_PREMERGE_SIMILARITY,
      maxMerges: TOP_STORY_PREMERGE_MAX_MERGES,
      inputStories: premergeResult.candidateStoryIds.length,
      candidates: premergeResult.candidates,
      evaluatedPairs: premergeResult.evaluatedPairs,
      suggested: premergeResult.suggested,
      merged: premergeResult.merged
    },
    passesRun: passSummaries.length,
    passSummaries,
    details: details.map((detail) => ({
      storyId: detail.storyId,
      rank: detail.rank,
      title: detail.title,
      state: detail.state,
      topic: detail.topic,
      articleCount: detail.articleCount,
      sourceCount: detail.sourceCount,
      recentCount: detail.recentCount,
      hoursSinceLatest: detail.hoursSinceLatest,
      reasons: detail.reasons
    }))
  });

  if (demoted > 0) {
    await recordIngestGuardrailAlert({
      guardrailAlerts: [`top_story_publish_gate_demotions:${demoted}`],
      topStoryPublishGateChecked: checked,
      topStoryPublishGateFlagged: flagged,
      topStoryPublishGateDemoted: demoted,
      topStoryPremergeMerged: premergeResult.merged,
      topStoryPublishGatePasses: passSummaries,
      topStoryPublishGateStoryIds: Array.from(demotedStoryIds)
    });
  }

  return {
    checked,
    flagged,
    demoted,
    details
  };
}

type TopStoryDuplicatePair = {
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

type GuardrailEmailEventDetail = {
  alertType?: string;
  sent?: boolean;
  fingerprint?: string;
};

type GuardrailEmailEventRow = {
  created_at: string;
  detail: GuardrailEmailEventDetail | null;
};

function duplicatePairFingerprint(pairs: TopStoryDuplicatePair[]) {
  return pairs
    .map((pair) => [pair.leftStoryId, pair.rightStoryId].sort().join(":"))
    .sort()
    .join("|");
}

function formatDuplicatePairLine(index: number, pair: TopStoryDuplicatePair) {
  return [
    `${index + 1}) #${pair.leftRank}: ${pair.leftTitle}`,
    `   #${pair.rightRank}: ${pair.rightTitle}`,
    `   overlap=${Math.round(pair.ratio * 100)}% shared=${pair.sharedTokens} action=${pair.sharedActionTokens} strong=${pair.sharedStrongTokens}`,
    `   stories: ${GUARDRAIL_ALERT_SITE_URL}/stories/${pair.leftStoryId} | ${GUARDRAIL_ALERT_SITE_URL}/stories/${pair.rightStoryId}`
  ].join("\n");
}

async function maybeSendTopStoryDuplicateEmail(params: {
  checked: number;
  threshold: number;
  similarity: number;
  pairs: TopStoryDuplicatePair[];
}) {
  if (params.pairs.length === 0) return;
  if (
    !GUARDRAIL_ALERT_EMAIL_SMTP_HOST ||
    !GUARDRAIL_ALERT_EMAIL_SMTP_USER ||
    !GUARDRAIL_ALERT_EMAIL_SMTP_PASS ||
    !GUARDRAIL_ALERT_EMAIL_FROM ||
    GUARDRAIL_ALERT_EMAIL_TO.length === 0
  ) {
    return;
  }

  const fingerprint = duplicatePairFingerprint(params.pairs);
  const cooldownMs = GUARDRAIL_ALERT_EMAIL_COOLDOWN_MINUTES * 60 * 1000;

  let shouldSend = true;
  try {
    const latestEvent = await pool.query<GuardrailEmailEventRow>(
      `select created_at, detail
       from admin_events
       where event_type = 'ingest_guardrail_email'
         and coalesce(detail->>'alertType', '') = 'top_story_duplicate_pairs'
         and coalesce((detail->>'sent')::boolean, false) = true
       order by created_at desc
       limit 1`
    );
    const previous = latestEvent.rows[0];
    if (previous) {
      const previousFingerprint = String(previous.detail?.fingerprint ?? "");
      const previousTime = new Date(previous.created_at).getTime();
      const now = Date.now();
      if (
        previousFingerprint === fingerprint &&
        Number.isFinite(previousTime) &&
        now - previousTime < cooldownMs
      ) {
        shouldSend = false;
      }
    }
  } catch (error) {
    console.error(
      `[ingest] failed to load previous guardrail email events: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!shouldSend) return;

  const subject = `[PulseK12] Top story duplicates detected (${params.pairs.length})`;
  const body = [
    `Pulse guardrail alert: ${params.pairs.length} duplicate top-story pair(s) detected.`,
    `Checked top stories: ${params.checked}`,
    `Duplicate threshold: ${params.threshold}`,
    `Similarity threshold: ${params.similarity.toFixed(2)}`,
    "",
    "Pairs:",
    ...params.pairs.map((pair, index) => formatDuplicatePairLine(index, pair)),
    "",
    `Review in admin: ${GUARDRAIL_ALERT_SITE_URL}/admin/stories`,
    `Detected at: ${new Date().toISOString()}`
  ].join("\n");

  try {
    await sendSmtpTextEmail({
      host: GUARDRAIL_ALERT_EMAIL_SMTP_HOST,
      port: GUARDRAIL_ALERT_EMAIL_SMTP_PORT,
      username: GUARDRAIL_ALERT_EMAIL_SMTP_USER,
      password: GUARDRAIL_ALERT_EMAIL_SMTP_PASS,
      from: GUARDRAIL_ALERT_EMAIL_FROM,
      to: GUARDRAIL_ALERT_EMAIL_TO,
      subject,
      text: body,
      ehloHost: GUARDRAIL_ALERT_EMAIL_EHLO
    });
    await recordGuardrailEmailEvent({
      alertType: "top_story_duplicate_pairs",
      sent: true,
      fingerprint,
      to: GUARDRAIL_ALERT_EMAIL_TO,
      pairCount: params.pairs.length,
      checked: params.checked,
      threshold: params.threshold,
      similarity: params.similarity
    });
  } catch (error) {
    console.error(
      `[ingest] failed to send duplicate guardrail email: ${error instanceof Error ? error.message : String(error)}`
    );
    await recordGuardrailEmailEvent({
      alertType: "top_story_duplicate_pairs",
      sent: false,
      fingerprint,
      to: GUARDRAIL_ALERT_EMAIL_TO,
      pairCount: params.pairs.length,
      checked: params.checked,
      threshold: params.threshold,
      similarity: params.similarity,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

type LinkedInTopStoryCandidate = {
  storyId: string;
  rank: number;
  title: string;
  summary: string | null;
  sourceCount: number;
};

type StorySourceNameRow = {
  source_name: string | null;
};

function normalizeLinkedInLine(input: string | null | undefined) {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateLinkedInLine(input: string, max = 260) {
  if (input.length <= max) return input;
  const trimmed = input.slice(0, max).trim();
  const boundary = trimmed.lastIndexOf(" ");
  if (boundary > 60) return `${trimmed.slice(0, boundary).trim()}...`;
  return `${trimmed}...`;
}

function ensureSentence(input: string) {
  if (!input) return input;
  if (/[.!?]$/.test(input)) return input;
  return `${input}.`;
}

function formatSourceList(names: string[]) {
  if (names.length === 0) return "multiple national outlets";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function buildLinkedInPost(params: {
  title: string;
  summary: string | null;
  sourceCount: number;
  sourceNames: string[];
}) {
  const headline = ensureSentence(truncateLinkedInLine(normalizeLinkedInLine(params.title), 240));
  const meaningBase = normalizeLinkedInLine(params.summary);
  const meaning = ensureSentence(
    truncateLinkedInLine(
      meaningBase ||
        "Coverage is building across multiple outlets, signaling a high-impact development for school systems.",
      240
    )
  );

  return [
    `📊 ${params.sourceCount}+ outlets are reporting: ${headline}`,
    "",
    `What this means for K-12 leaders: ${meaning}`,
    "",
    "📍 Follow stories like this and other trending K-12 stories at PulseK12.com, where headlines from major outlets update throughout the day.",
    "",
    `Reported by ${formatSourceList(params.sourceNames)}.`,
    "",
    "#K12Education #EducationNews #SchoolLeadership #EdTech"
  ].join("\n");
}

async function wasLinkedInTopStoryAlertSent(storyId: string) {
  try {
    const result = await pool.query(
      `select 1
       from admin_events
       where event_type = 'ingest_guardrail_email'
         and coalesce(detail->>'alertType', '') = 'linkedin_post_ready'
         and coalesce((detail->>'sent')::boolean, false) = true
         and coalesce(detail->>'storyId', '') = $1
       limit 1`,
      [storyId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error(
      `[ingest] failed to load previous LinkedIn post alerts: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

async function loadStorySourceNames(storyId: string, limit: number) {
  try {
    const result = await pool.query<StorySourceNameRow>(
      `select src.name as source_name
       from story_articles sa
       join articles a on a.id = sa.article_id
       left join sources src on src.id = a.source_id
       where sa.story_id = $1
         and src.name is not null
       group by src.name
       order by max(coalesce(a.published_at, a.fetched_at)) desc
       limit $2`,
      [storyId, limit]
    );
    return result.rows
      .map((row) => String(row.source_name ?? "").trim())
      .filter((value) => value.length > 0);
  } catch (error) {
    console.error(
      `[ingest] failed to load source names for LinkedIn post alert: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

async function maybeSendTopStoryLinkedInEmail() {
  if (!LINKEDIN_TOP_STORY_EMAIL_ENABLED) return;
  if (
    !GUARDRAIL_ALERT_EMAIL_SMTP_HOST ||
    !GUARDRAIL_ALERT_EMAIL_SMTP_USER ||
    !GUARDRAIL_ALERT_EMAIL_SMTP_PASS ||
    !GUARDRAIL_ALERT_EMAIL_FROM ||
    GUARDRAIL_ALERT_EMAIL_TO.length === 0
  ) {
    return;
  }

  const topStories = await getTopStories(
    Math.max(20, LINKEDIN_TOP_STORY_EMAIL_RANK_LIMIT),
    undefined,
    {
      useAiRerank: false,
      useStoredRank: true
    }
  );
  const rankedWindow = topStories
    .filter((story) => story.status !== "hidden" && story.status !== "demoted")
    .slice(0, LINKEDIN_TOP_STORY_EMAIL_RANK_LIMIT);

  const candidates: LinkedInTopStoryCandidate[] = rankedWindow
    .map((story, index) => ({
      storyId: story.id,
      rank: index + 1,
      title: String(story.editor_title ?? story.title ?? "").trim(),
      summary: String(story.editor_summary ?? story.summary ?? "").trim() || null,
      sourceCount: Math.max(0, Number(story.source_count ?? 0))
    }))
    .filter((candidate) => candidate.title.length > 0)
    .filter((candidate) => candidate.sourceCount >= LINKEDIN_TOP_STORY_EMAIL_MIN_SOURCES);

  if (candidates.length === 0) return;

  let selected: LinkedInTopStoryCandidate | null = null;
  for (const candidate of candidates) {
    const alreadySent = await wasLinkedInTopStoryAlertSent(candidate.storyId);
    if (!alreadySent) {
      selected = candidate;
      break;
    }
  }
  if (!selected) return;

  const sourceNames = await loadStorySourceNames(
    selected.storyId,
    LINKEDIN_TOP_STORY_EMAIL_MAX_SOURCE_NAMES
  );
  const linkedinPost = buildLinkedInPost({
    title: selected.title,
    summary: selected.summary,
    sourceCount: selected.sourceCount,
    sourceNames
  });

  const storyUrl = `${GUARDRAIL_ALERT_SITE_URL}/stories/${selected.storyId}`;
  const subject = `[PulseK12] LinkedIn post ready: #${selected.rank} (${selected.sourceCount} sources)`;
  const body = [
    `A top story reached your LinkedIn threshold (>=${LINKEDIN_TOP_STORY_EMAIL_MIN_SOURCES} sources).`,
    `Top rank: #${selected.rank}`,
    `Source count: ${selected.sourceCount}`,
    `Story: ${storyUrl}`,
    `Admin: ${GUARDRAIL_ALERT_SITE_URL}/admin/stories`,
    "",
    "Copy/paste LinkedIn post:",
    "",
    linkedinPost,
    "",
    `Generated at: ${new Date().toISOString()}`
  ].join("\n");

  try {
    await sendSmtpTextEmail({
      host: GUARDRAIL_ALERT_EMAIL_SMTP_HOST,
      port: GUARDRAIL_ALERT_EMAIL_SMTP_PORT,
      username: GUARDRAIL_ALERT_EMAIL_SMTP_USER,
      password: GUARDRAIL_ALERT_EMAIL_SMTP_PASS,
      from: GUARDRAIL_ALERT_EMAIL_FROM,
      to: GUARDRAIL_ALERT_EMAIL_TO,
      subject,
      text: body,
      ehloHost: GUARDRAIL_ALERT_EMAIL_EHLO
    });
    await recordGuardrailEmailEvent({
      alertType: "linkedin_post_ready",
      sent: true,
      storyId: selected.storyId,
      rank: selected.rank,
      sourceCount: selected.sourceCount,
      sourceNames,
      threshold: LINKEDIN_TOP_STORY_EMAIL_MIN_SOURCES,
      rankLimit: LINKEDIN_TOP_STORY_EMAIL_RANK_LIMIT,
      to: GUARDRAIL_ALERT_EMAIL_TO
    });
  } catch (error) {
    console.error(
      `[ingest] failed to send LinkedIn top-story email: ${error instanceof Error ? error.message : String(error)}`
    );
    await recordGuardrailEmailEvent({
      alertType: "linkedin_post_ready",
      sent: false,
      storyId: selected.storyId,
      rank: selected.rank,
      sourceCount: selected.sourceCount,
      sourceNames,
      threshold: LINKEDIN_TOP_STORY_EMAIL_MIN_SOURCES,
      rankLimit: LINKEDIN_TOP_STORY_EMAIL_RANK_LIMIT,
      to: GUARDRAIL_ALERT_EMAIL_TO,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function auditTopStoryDuplicatePairs() {
  const candidates = await getTopStories(TOP_STORY_DUPLICATE_AUDIT_LIMIT, undefined, {
    useAiRerank: false,
    useStoredRank: true
  });
  const topStories = candidates
    .filter((story) => story.status !== "hidden")
    .slice(0, TOP_STORY_DUPLICATE_AUDIT_LIMIT);

  const pairs: TopStoryDuplicatePair[] = [];

  for (let i = 0; i < topStories.length; i += 1) {
    const left = topStories[i];
    if (!left) continue;

    for (let j = i + 1; j < topStories.length; j += 1) {
      const right = topStories[j];
      if (!right) continue;
      const decision = evaluateStoryMergeDecision(
        {
          id: left.id,
          title: String(left.editor_title ?? left.title ?? "").trim(),
          status: left.status ?? "active",
          article_count: Math.max(1, Number(left.article_count ?? 1))
        },
        {
          id: right.id,
          title: String(right.editor_title ?? right.title ?? "").trim(),
          status: right.status ?? "active",
          article_count: Math.max(1, Number(right.article_count ?? 1))
        },
        TOP_STORY_DUPLICATE_AUDIT_SIMILARITY
      );
      if (!decision.shouldMerge) continue;

      pairs.push({
        leftStoryId: left.id,
        rightStoryId: right.id,
        leftRank: i + 1,
        rightRank: j + 1,
        leftTitle: String(left.editor_title ?? left.title ?? "").trim(),
        rightTitle: String(right.editor_title ?? right.title ?? "").trim(),
        ratio: Number(decision.details.ratio.toFixed(2)),
        sharedTokens: decision.details.sharedTokens,
        sharedActionTokens: decision.details.sharedActionTokens,
        sharedStrongTokens: decision.details.sharedStrongTokens
      });
    }
  }

  return {
    checked: topStories.length,
    duplicatePairs: pairs
  };
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
  let relevanceChecked = 0;
  let relevanceRejected = 0;
  const relevanceCheckLimit = 100;
  const scrapeSummaryLimit = 30;
  let scrapeSummaries = 0;

  for (const feed of feeds) {
    let parsed;
    try {
      if (feed.feedType === "scrape") {
        parsed = await parseScrapeFeed(feed.url, feed.domain);
      } else {
        parsed = await parseFeedViaHttp(feed.url);
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

    const perFeedLimit = feed.feedType === "discovery" ? MAX_ITEMS_PER_DISCOVERY_FEED : MAX_ITEMS_PER_FEED;
    for (const item of parsed.items.slice(0, perFeedLimit)) {
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

      // Cache check: if article already exists with a decent summary, reuse it
      const cachedRow = await pool.query(
        `select summary, summary_candidates from articles where url = $1 limit 1`,
        [normalizedUrl]
      );
      if (cachedRow.rows.length > 0) {
        const cachedSummary = (cachedRow.rows[0].summary as string | null) ?? "";
        if (cachedSummary.trim().length >= 40) {
          addSummaryCandidate(summaryCandidates, "existing", cachedSummary, title);
        }
      }

      // Tier-based scrape priority:
      // Tier A: RSS is usually good — only scrape (free) if RSS is completely missing
      // Tier B: scrape (free) if RSS summary < 50 chars
      // Tier C/unknown: always try scrape
      const bestRssLen = summaryCandidates
        .filter((c) => c.text)
        .reduce((max, c) => Math.max(max, c.text.length), 0);
      const needsScrape =
        feed.tier === "A"
          ? bestRssLen === 0 && feed.feedType === "scrape"
          : feed.tier === "B"
            ? feed.feedType === "scrape" || bestRssLen < 50
            : feed.feedType === "scrape" ||
              summaryCandidates.length === 0 ||
              summaryCandidates.every((c) => !c.text || c.text.trim().length < 40 || c.score < 0.45);

      // Try free HTTP scrape first (no API credits)
      if (needsScrape) {
        try {
          const freeText = await freeArticleScrape(normalizedUrl);
          addSummaryCandidate(summaryCandidates, "scrape", freeText, title);
        } catch {
          // Free scrape failed silently — will try Firecrawl next
        }
      }

      // Only use Firecrawl for Tier C/unknown when free scrape failed
      const stillNeedsScrape =
        needsScrape &&
        feed.tier !== "A" && feed.tier !== "B" &&
        summaryCandidates.every((c) => !c.text || c.text.trim().length < 40 || c.score < 0.45);
      const shouldTryFirecrawl =
        stillNeedsScrape &&
        canUseFirecrawl() &&
        (await hasFirecrawlBudgetRemaining()) &&
        scrapeSummaries < scrapeSummaryLimit;
      if (shouldTryFirecrawl) {
        try {
          const scraped = await fetchArticleSummary(normalizedUrl);
          const added = addSummaryCandidate(summaryCandidates, "scrape", scraped, title);
          if (added) {
            scrapeSummaries += 1;
          }
        } catch (error) {
          if (!isFirecrawlQuotaLikeError(error)) {
            console.error(
              `[ingest] failed to fetch article summary ${normalizedUrl}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
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
      if (
        isClearlyOffTopicForK12({
          title,
          summary,
          url: normalizedUrl
        })
      ) {
        skipped += 1;
        relevanceRejected += 1;
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
      const isApEducationFeed =
        feed.domain === "apnews.com" &&
        feed.feedType === "scrape" &&
        /\/hub\/education(?:\/|$)/i.test(feed.url);
      const apHasK12Signal = isApEducationFeed
        ? hasStrictK12TopicSignal({
            title,
            summary,
            url: normalizedUrl
          })
        : true;

      // AI relevance gate for discovery feeds, unknown-tier sources, and AP education wire.
      let relevanceResult: ContentRelevanceDecision | null = null;
      const needsRelevanceCheck =
        (feed.feedType === "discovery" || feed.tier === "unknown" || isApEducationFeed) &&
        relevanceChecked < relevanceCheckLimit;
      if (needsRelevanceCheck) {
        relevanceResult = await classifyContentRelevance(title, summary);
        if (relevanceResult) {
          relevanceChecked += 1;
          if (!relevanceResult.relevant && relevanceResult.score < 0.3) {
            skipped += 1;
            relevanceRejected += 1;
            continue;
          }
          if (relevanceResult.score >= 0.3 && relevanceResult.score < 0.5) {
            quality.label = "uncertain";
          }
        }
      }
      if (isApEducationFeed) {
        const apRelevanceScore = relevanceResult?.score ?? null;
        const apPassesScore =
          typeof apRelevanceScore === "number" && apRelevanceScore >= AP_WIRE_MIN_RELEVANCE_SCORE;
        if (!apHasK12Signal && !apPassesScore) {
          skipped += 1;
          relevanceRejected += 1;
          continue;
        }
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
           published_at,
           relevance_score,
           relevance_category,
           relevance_reason,
           relevance_checked_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11, now(), $12::jsonb, $13, $14, $15, $16, $17)
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
           relevance_score = coalesce(excluded.relevance_score, articles.relevance_score),
           relevance_category = coalesce(excluded.relevance_category, articles.relevance_category),
           relevance_reason = coalesce(excluded.relevance_reason, articles.relevance_reason),
           relevance_checked_at = coalesce(excluded.relevance_checked_at, articles.relevance_checked_at),
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
          publishedAt,
          relevanceResult?.score ?? null,
          relevanceResult?.category ?? null,
          relevanceResult?.reason ?? null,
          relevanceResult ? new Date() : null
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
  let mergedStories = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    const mergePass = await mergeSimilarStories({
      lookbackDays: 5,
      candidateLimit: 280,
      maxMerges: 40,
      similarityThreshold: 0.56
    });
    mergedStories += mergePass.merged;
    if (mergePass.merged === 0) break;
  }
  const splitPass = await splitMixedStories({
    lookbackDays: 5,
    candidateLimit: 220,
    maxSplits: 24
  });
  const guardrailAlerts = groupingGuardrailAlerts({
    grouped,
    mergedStories,
    mixedStoryOutliers: splitPass.flagged,
    mixedStoriesSplit: splitPass.split
  });
  if (guardrailAlerts.length > 0) {
    const detail = {
      guardrailAlerts,
      grouped,
      mergedStories,
      mixedStoryCandidates: splitPass.candidates,
      mixedStoryOutliers: splitPass.flagged,
      mixedStoriesSplit: splitPass.split
    };
    console.warn(`[ingest] grouping guardrail alerts: ${guardrailAlerts.join(", ")}`);
    await recordIngestGuardrailAlert(detail);
  }
  const summaryFill = await fillStorySummaries(100, undefined, true, 50);
  const publishGate = await runTopStoriesPublishGate();
  const rankRefresh = await refreshHomepageRanks(60);
  await maybeSendTopStoryLinkedInEmail();
  const topStoryDuplicateAudit = await auditTopStoryDuplicatePairs();
  const topStoryDuplicatePairs = topStoryDuplicateAudit.duplicatePairs.length;
  const shouldAlertOnTopStoryDuplicates =
    Number.isFinite(INGEST_ALERT_TOP_STORY_DUPLICATE_PAIRS) &&
    topStoryDuplicatePairs >= INGEST_ALERT_TOP_STORY_DUPLICATE_PAIRS;
  if (shouldAlertOnTopStoryDuplicates) {
    const duplicateAlertDetail = {
      guardrailAlerts: [`top_story_duplicate_pairs:${topStoryDuplicatePairs}`],
      topStoryDuplicateAuditChecked: topStoryDuplicateAudit.checked,
      topStoryDuplicateAuditThreshold: INGEST_ALERT_TOP_STORY_DUPLICATE_PAIRS,
      topStoryDuplicateAuditSimilarity: TOP_STORY_DUPLICATE_AUDIT_SIMILARITY,
      topStoryDuplicateAuditPairs: topStoryDuplicateAudit.duplicatePairs
    };
    await recordIngestGuardrailAlert(duplicateAlertDetail);
    await maybeSendTopStoryDuplicateEmail({
      checked: topStoryDuplicateAudit.checked,
      threshold: INGEST_ALERT_TOP_STORY_DUPLICATE_PAIRS,
      similarity: TOP_STORY_DUPLICATE_AUDIT_SIMILARITY,
      pairs: topStoryDuplicateAudit.duplicatePairs
    });
  }

  return {
    feeds: feeds.length,
    fetchedItems,
    inserted,
    updated,
    skipped,
    unresolvedGoogleSkipped,
    grouped,
    mergedStories,
    mixedStoryCandidates: splitPass.candidates,
    mixedStoryOutliers: splitPass.flagged,
    mixedStoriesSplit: splitPass.split,
    guardrailAlerts,
    parseFailures,
    qualityChecked: qualityScan.qualityChecked,
    nonArticleBlocked,
    nonArticleFlagged: qualityScan.nonArticleFlagged,
    summariesEnriched: summaryFill.enriched,
    summaryAdjudicatedAI: summaryFill.adjudicatedAI,
    summaryAdjudicatedDeterministic: summaryFill.adjudicatedDeterministic,
    summaryGeneratedLLM: summaryFill.llmGenerated,
    summaryRejected: summaryFill.rejected,
    homepageRanked: rankRefresh.ranked,
    publishGateChecked: publishGate.checked,
    publishGateFlagged: publishGate.flagged,
    publishGateDemoted: publishGate.demoted,
    topStoryDuplicatePairs,
    relevanceChecked,
    relevanceRejected
  };
}
