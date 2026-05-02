import { sourceFamilyFromArticle } from "./source-family";

export type SingleSourceAuditReason =
  | "no_candidate_found"
  | "candidate_filtered_quality"
  | "candidate_filtered_relevance"
  | "candidate_canonical_duplicate"
  | "candidate_source_family_duplicate"
  | "candidate_state_mismatch"
  | "candidate_entity_conflict"
  | "candidate_time_window_mismatch"
  | "candidate_similarity_too_low"
  | "candidate_in_different_cluster";

const AGGREGATOR_DOMAINS = new Set([
  "apple.news",
  "aol.com",
  "finance.yahoo.com",
  "flipboard.com",
  "ground.news",
  "msn.com",
  "news.google.com",
  "newsbreak.com",
  "smartnews.com",
  "yahoo.com"
]);

const COVERAGE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "new",
  "of",
  "on",
  "or",
  "over",
  "report",
  "reports",
  "says",
  "school",
  "schools",
  "student",
  "students",
  "teacher",
  "teachers",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "why",
  "will",
  "with"
]);

export function normalizeCoverageDomain(domain: string | null | undefined) {
  return String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

export function isAggregatorDomain(domain: string | null | undefined) {
  const normalized = normalizeCoverageDomain(domain);
  if (!normalized) return false;
  if (AGGREGATOR_DOMAINS.has(normalized)) return true;
  return Array.from(AGGREGATOR_DOMAINS).some((aggregator) => normalized.endsWith(`.${aggregator}`));
}

function normalizeCoverageToken(token: string) {
  let normalized = token.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return "";
  if (normalized.endsWith("ies") && normalized.length > 4) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (normalized.endsWith("es") && normalized.length > 4 && !normalized.endsWith("ves")) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.endsWith("s") && normalized.length > 3 && !normalized.endsWith("is")) {
    normalized = normalized.slice(0, -1);
  }
  if (normalized.endsWith("ing") && normalized.length > 5) {
    normalized = normalized.slice(0, -3);
  } else if (normalized.endsWith("ed") && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  }
  return normalized;
}

export function coverageTokens(text: string | null | undefined) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map(normalizeCoverageToken)
    .filter((token) => token.length >= 3 && !COVERAGE_STOPWORDS.has(token));
}

export function coverageLexicalSimilarity(left: string, right: string) {
  const leftTokens = Array.from(new Set(coverageTokens(left)));
  const rightTokens = Array.from(new Set(coverageTokens(right)));
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  return shared / Math.max(1, Math.min(leftTokens.length, rightTokens.length));
}

export function titleLedeSimilarity(params: {
  seedTitle: string;
  seedSummary?: string | null;
  candidateTitle: string;
  candidateSummary?: string | null;
}) {
  const titleScore = coverageLexicalSimilarity(params.seedTitle, params.candidateTitle);
  const combinedScore = coverageLexicalSimilarity(
    `${params.seedTitle} ${params.seedSummary ?? ""}`,
    `${params.candidateTitle} ${params.candidateSummary ?? ""}`
  );
  return Number(Math.max(titleScore, combinedScore).toFixed(3));
}

export function isWithinCoverageWindow(
  seedDate: Date,
  candidateDate: Date | null,
  windowHours: number
) {
  if (!candidateDate || Number.isNaN(candidateDate.getTime())) return false;
  if (Number.isNaN(seedDate.getTime())) return false;
  const deltaHours = Math.abs(seedDate.getTime() - candidateDate.getTime()) / (1000 * 60 * 60);
  return deltaHours <= windowHours;
}

export function buildCorroborationSearchQuery(title: string) {
  const tokens = Array.from(new Set(coverageTokens(title))).slice(0, 8);
  return tokens.join(" ");
}

export function coverageSourceFamily(params: {
  domain: string | null | undefined;
  title?: string | null;
  summary?: string | null;
  sourceName?: string | null;
}) {
  return sourceFamilyFromArticle(params);
}
