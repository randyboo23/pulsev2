import type { NewsletterRankingReason } from "@pulse/core";

export type RankingInputs = {
  title: string;
  summary: string | null;
  articleCount: number;
  sourceCount?: number;
  familyCount?: number;
  recentCount?: number;
  avgWeight: number;
  latestAt: Date;
};

export type StoryType = "breaking" | "policy" | "feature" | "evergreen" | "opinion";

export type RankingBreakdown = {
  impact: number;
  urgency: number;
  policyHits: number;
  novelty: number;
  relevance: number;
  hardNewsSignals: number;
  volume: number;
  sourceDiversity: number;
  familyDiversity: number;
  recency: number;
  avgWeight: number;
  authorityMultiplier: number;
  evergreenPenalty: number;
  singletonPenalty: number;
  singleSourcePenalty: number;
  thinCoveragePenalty: number;
  hardNewsPenalty: number;
  lowNewsFeature: boolean;
  lowAuthoritySingleton: boolean;
  weakEvergreenSignals: boolean;
  hoursSince: number;
};

export type StoryRankingAnalysis = {
  score: number;
  storyType: StoryType;
  leadEligible: boolean;
  leadReason: string | null;
  urgencyOverride: boolean;
  breakdown: RankingBreakdown;
};

export type NewsletterRankingBreakdown = {
  impact: number;
  urgency: number;
  policyHits: number;
  relevance: number;
  volume: number;
  sourceDiversity: number;
  familyDiversity: number;
  weeklyRecency: number;
  operatorFit: number;
  avgWeight: number;
  authorityMultiplier: number;
  momentumBonus: number;
  coverageBoost: number;
  evergreenPenalty: number;
  singletonPenalty: number;
  singleSourcePenalty: number;
  thinCoveragePenalty: number;
  hardNewsPenalty: number;
  hoursSince: number;
};

export type NewsletterRankingAnalysis = {
  score: number;
  storyType: StoryType;
  urgencyOverride: boolean;
  whyRanked: NewsletterRankingReason[];
  breakdown: NewsletterRankingBreakdown;
};

export type Audience = "teachers" | "admins" | "edtech";

const AUDIENCE_KEYWORDS: Record<Audience, string[]> = {
  teachers: [
    "teacher",
    "teachers",
    "classroom",
    "instruction",
    "curriculum",
    "lesson",
    "professional development",
    "literacy",
    "math",
    "student learning"
  ],
  admins: [
    "superintendent",
    "principal",
    "district",
    "school board",
    "budget",
    "funding",
    "policy",
    "state",
    "accountability",
    "compliance"
  ],
  edtech: [
    "edtech",
    "education technology",
    "ai",
    "platform",
    "software",
    "tools",
    "data privacy",
    "cybersecurity",
    "implementation"
  ]
};

const EDTECH_EXPLICIT_TERMS = [
  "edtech",
  "education technology",
  "student data privacy",
  "school cybersecurity",
  "learning management system",
  "digital learning",
  "technology procurement"
] as const;

const EDTECH_TECH_TERMS = [
  "ai",
  "artificial intelligence",
  "chatbot",
  "software",
  "platform",
  "cybersecurity",
  "privacy",
  "screen time",
  "device",
  "devices",
  "technology",
  "tech",
  "digital",
  "lms"
] as const;

const EDTECH_CONTEXT_TERMS = [
  "school",
  "schools",
  "district",
  "districts",
  "student",
  "students",
  "teacher",
  "teachers",
  "classroom",
  "classrooms",
  "k-12",
  "curriculum",
  "instruction",
  "superintendent"
] as const;

const EDTECH_HIGHER_ED_TERMS = [
  "college",
  "colleges",
  "university",
  "universities",
  "community college",
  "community colleges",
  "campus",
  "campuses",
  "higher ed",
  "higher education"
] as const;

const EDTECH_K12_OVERRIDE_TERMS = [
  "school",
  "schools",
  "teacher",
  "teachers",
  "classroom",
  "classrooms",
  "public school",
  "k-12",
  "elementary school",
  "middle school",
  "high school"
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWholeAudienceTerm(text: string, term: string) {
  const escaped = escapeRegExp(term.trim()).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
}

function matchesEdtechAudience(text: string) {
  const higherEdOnly =
    EDTECH_HIGHER_ED_TERMS.some((term) => containsWholeAudienceTerm(text, term)) &&
    !EDTECH_K12_OVERRIDE_TERMS.some((term) => containsWholeAudienceTerm(text, term));
  if (higherEdOnly) return false;

  if (EDTECH_EXPLICIT_TERMS.some((term) => containsWholeAudienceTerm(text, term))) {
    return true;
  }

  const hasTechSignal = EDTECH_TECH_TERMS.some((term) => containsWholeAudienceTerm(text, term));
  if (!hasTechSignal) return false;

  return EDTECH_CONTEXT_TERMS.some((term) => containsWholeAudienceTerm(text, term));
}

export function storyMatchesAudience(text: string, audience: Audience) {
  const lowered = text.toLowerCase();
  if (audience === "edtech") {
    return matchesEdtechAudience(lowered);
  }

  const terms = AUDIENCE_KEYWORDS[audience] ?? [];
  return terms.some((term) => containsWholeAudienceTerm(lowered, term));
}

const KEYWORDS = {
  impact: [
    "legislation",
    "bill",
    "policy",
    "funding",
    "budget",
    "superintendent",
    "district",
    "statewide",
    "board",
    "mandate"
  ],
  urgency: [
    "emergency",
    "closure",
    "lockdown",
    "safety",
    "security",
    "threat",
    "shooting",
    "outbreak",
    "urgent"
  ],
  novelty: [
    "pilot",
    "launch",
    "new",
    "first",
    "rollout",
    "initiative",
    "program",
    "expansion"
  ],
  relevance: [
    "teacher",
    "students",
    "classroom",
    "curriculum",
    "school",
    "k-12",
    "k12",
    "principal",
    "edtech"
  ]
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

const INSTRUCTIONAL_HINTS = [
  "teaching",
  "classroom",
  "lesson",
  "student engagement",
  "instructional",
  "activity",
  "activities",
  "professional development",
  "how educators",
  "for teachers"
];

const SOURCE_DIVERSITY_WEIGHT = 1.05;
const SINGLE_SOURCE_IMPORTANCE_URGENCY = 2;
const SINGLE_SOURCE_IMPORTANCE_IMPACT = 2;
const SINGLE_SOURCE_IMPORTANCE_POLICY = 2;
const SINGLE_SOURCE_SOFT_PENALTY_AUTHORITY = 0.9;
const SINGLE_SOURCE_SOFT_PENALTY_LOW_AUTHORITY = 0.85;

function countHits(text: string, terms: string[]) {
  const lowered = text.toLowerCase();
  return terms.reduce((count, term) => (lowered.includes(term) ? count + 1 : count), 0);
}

function classifyStoryType(params: {
  text: string;
  weakEvergreenSignals: boolean;
  impact: number;
  urgency: number;
  policyHits: number;
  novelty: number;
}): StoryType {
  const { text, weakEvergreenSignals, impact, urgency, policyHits, novelty } = params;
  if (countHits(text, OPINION_HINTS) > 0) return "opinion";

  const breakingHits = countHits(text, BREAKING_HINTS);
  if (breakingHits > 0) return "breaking";

  if (policyHits > 0) return "policy";

  const evergreenHits = countHits(text, EVERGREEN_HINTS);
  const instructionalHits = countHits(text, INSTRUCTIONAL_HINTS);
  if (evergreenHits > 0) return "evergreen";
  if (instructionalHits > 0 && policyHits === 0 && urgency === 0 && impact === 0 && novelty === 0) return "evergreen";
  if (instructionalHits > 0 && weakEvergreenSignals) return "evergreen";

  return "feature";
}

export function analyzeStoryRanking(inputs: RankingInputs): StoryRankingAnalysis {
  const text = `${inputs.title} ${inputs.summary ?? ""}`;
  const impact = Math.min(countHits(text, KEYWORDS.impact), 3);
  const urgency = Math.min(countHits(text, KEYWORDS.urgency), 3);
  const policyHits = Math.min(countHits(text, POLICY_HINTS), 3);
  const novelty = Math.min(countHits(text, KEYWORDS.novelty), 3);
  const relevance = Math.min(countHits(text, KEYWORDS.relevance), 3);
  const hardNewsSignals = urgency + Math.min(policyHits, 1);

  const sourceCount = Number.isFinite(inputs.sourceCount ?? 0) ? Number(inputs.sourceCount ?? 0) : 0;
  const familyCount = Number.isFinite(inputs.familyCount ?? 0) ? Number(inputs.familyCount ?? 0) : 0;
  const independentSourceCount =
    familyCount > 0 ? familyCount : sourceCount;
  const recentCount = Number.isFinite(inputs.recentCount ?? 0) ? Number(inputs.recentCount ?? 0) : 0;
  const volume = Math.log1p(inputs.articleCount);
  const sourceDiversity = Math.log1p(Math.max(0, sourceCount));
  const familyDiversity = Math.log1p(Math.max(0, independentSourceCount));
  const hoursSince = (Date.now() - inputs.latestAt.getTime()) / (1000 * 60 * 60);
  const recency = 1.1 * Math.exp(-hoursSince / 30);
  const weakEvergreenSignals = hoursSince > 18 && independentSourceCount <= 1 && recentCount <= 1;
  const storyType = classifyStoryType({
    text,
    weakEvergreenSignals,
    impact,
    urgency,
    policyHits,
    novelty
  });
  const urgencyOverride = urgency > 0 && (hoursSince <= 6 || recentCount >= 2);

  const evergreenPenalty = storyType === "evergreen" && !urgencyOverride ? 0.35 : 1;
  const baseWeight = Math.max(0.45, Math.min(1.5, inputs.avgWeight));
  const authorityMultiplier = Math.max(0.3, Math.min(2.2, Math.pow(baseWeight, 3)));
  const lowAuthoritySingleton =
    independentSourceCount <= 1 && recentCount <= 1 && inputs.articleCount <= 1 && authorityMultiplier < 1;
  const singletonPenalty = !urgencyOverride && lowAuthoritySingleton ? 0.75 : 1;
  const importantSingleSource =
    independentSourceCount <= 1 &&
    (urgency >= SINGLE_SOURCE_IMPORTANCE_URGENCY ||
      impact >= SINGLE_SOURCE_IMPORTANCE_IMPACT ||
      (policyHits >= SINGLE_SOURCE_IMPORTANCE_POLICY && recentCount >= 1));
  const singleSourcePenalty =
    !urgencyOverride &&
    independentSourceCount <= 1 &&
    storyType !== "breaking" &&
    !importantSingleSource
      ? authorityMultiplier >= 1
        ? SINGLE_SOURCE_SOFT_PENALTY_AUTHORITY
        : SINGLE_SOURCE_SOFT_PENALTY_LOW_AUTHORITY
      : 1;
  const thinCoveragePenalty =
    !urgencyOverride &&
    storyType !== "breaking" &&
    independentSourceCount <= 1 &&
    recentCount <= 1 &&
    inputs.articleCount <= 1
      ? 0.82
      : 1;
  const lowNewsFeature =
    storyType === "feature" &&
    !urgencyOverride &&
    hardNewsSignals === 0 &&
    independentSourceCount <= 2 &&
    recentCount <= 1;
  const hardNewsPenalty = lowNewsFeature ? (authorityMultiplier >= 1 ? 0.6 : 0.45) : 1;

  const base =
    impact * 2.2 +
    urgency * 1.8 +
    novelty * 1.0 +
    relevance * 1.3 +
    volume * 0.9 +
    (familyDiversity * SOURCE_DIVERSITY_WEIGHT + sourceDiversity * 0.35) +
    recency;

  const score =
    base *
    authorityMultiplier *
    evergreenPenalty *
    singletonPenalty *
    singleSourcePenalty *
    thinCoveragePenalty *
    hardNewsPenalty;

  let leadEligible = true;
  let leadReason: string | null = null;

  if (storyType === "evergreen" && !urgencyOverride) {
    leadEligible = false;
    leadReason = "evergreen_instructional";
  } else if (storyType === "opinion" && !urgencyOverride) {
    leadEligible = false;
    leadReason = "opinion_demoted";
  } else if (lowAuthoritySingleton && !urgencyOverride) {
    leadEligible = false;
    leadReason = "single_low_authority_source";
  } else if (lowNewsFeature) {
    leadEligible = false;
    leadReason = "low_newsworthiness_feature";
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
      policyHits,
      novelty,
      relevance,
      hardNewsSignals,
      volume: Number(volume.toFixed(2)),
      sourceDiversity: Number(sourceDiversity.toFixed(2)),
      familyDiversity: Number(familyDiversity.toFixed(2)),
      recency: Number(recency.toFixed(2)),
      avgWeight: Number(baseWeight.toFixed(2)),
      authorityMultiplier: Number(authorityMultiplier.toFixed(2)),
      evergreenPenalty: Number(evergreenPenalty.toFixed(2)),
      singletonPenalty: Number(singletonPenalty.toFixed(2)),
      singleSourcePenalty: Number(singleSourcePenalty.toFixed(2)),
      thinCoveragePenalty: Number(thinCoveragePenalty.toFixed(2)),
      hardNewsPenalty: Number(hardNewsPenalty.toFixed(2)),
      lowNewsFeature,
      lowAuthoritySingleton,
      weakEvergreenSignals,
      hoursSince: Number(hoursSince.toFixed(2))
    }
  };
}

export function analyzeNewsletterStoryRanking(inputs: RankingInputs): NewsletterRankingAnalysis {
  const text = `${inputs.title} ${inputs.summary ?? ""}`;
  const impact = Math.min(countHits(text, KEYWORDS.impact), 3);
  const urgency = Math.min(countHits(text, KEYWORDS.urgency), 3);
  const policyHits = Math.min(countHits(text, POLICY_HINTS), 3);
  const relevance = Math.min(countHits(text, KEYWORDS.relevance), 3);

  const sourceCount = Number.isFinite(inputs.sourceCount ?? 0) ? Number(inputs.sourceCount ?? 0) : 0;
  const familyCount = Number.isFinite(inputs.familyCount ?? 0) ? Number(inputs.familyCount ?? 0) : 0;
  const independentSourceCount = familyCount > 0 ? familyCount : sourceCount;
  const recentCount = Number.isFinite(inputs.recentCount ?? 0) ? Number(inputs.recentCount ?? 0) : 0;
  const volume = Math.log1p(inputs.articleCount);
  const sourceDiversity = Math.log1p(Math.max(0, sourceCount));
  const familyDiversity = Math.log1p(Math.max(0, independentSourceCount));
  const hoursSince = (Date.now() - inputs.latestAt.getTime()) / (1000 * 60 * 60);
  const weeklyRecency = 0.9 * Math.exp(-hoursSince / 96);
  const weakEvergreenSignals = hoursSince > 48 && independentSourceCount <= 1 && recentCount <= 1;
  const storyType = classifyStoryType({
    text,
    weakEvergreenSignals,
    impact,
    urgency,
    policyHits,
    novelty: 0
  });
  const urgencyOverride = urgency > 0 && (hoursSince <= 24 || recentCount >= 2);

  const evergreenPenalty = storyType === "evergreen" && !urgencyOverride ? 0.45 : 1;
  const baseWeight = Math.max(0.45, Math.min(1.5, inputs.avgWeight));
  const authorityMultiplier = Math.max(0.3, Math.min(2.2, Math.pow(baseWeight, 3)));
  const lowAuthoritySingleton =
    independentSourceCount <= 1 && recentCount <= 1 && inputs.articleCount <= 1 && authorityMultiplier < 1;
  const singletonPenalty = !urgencyOverride && lowAuthoritySingleton ? 0.82 : 1;
  const importantSingleSource =
    independentSourceCount <= 1 &&
    (urgency >= SINGLE_SOURCE_IMPORTANCE_URGENCY ||
      impact >= SINGLE_SOURCE_IMPORTANCE_IMPACT ||
      (policyHits >= SINGLE_SOURCE_IMPORTANCE_POLICY && recentCount >= 1));
  const singleSourcePenalty =
    !urgencyOverride &&
    independentSourceCount <= 1 &&
    storyType !== "breaking" &&
    !importantSingleSource
      ? authorityMultiplier >= 1
        ? 0.94
        : 0.9
      : 1;
  const thinCoveragePenalty =
    !urgencyOverride &&
    storyType !== "breaking" &&
    independentSourceCount <= 1 &&
    recentCount <= 1 &&
    inputs.articleCount <= 1
      ? 0.9
      : 1;
  const lowNewsFeature =
    storyType === "feature" &&
    !urgencyOverride &&
    impact === 0 &&
    policyHits === 0 &&
    independentSourceCount <= 2 &&
    recentCount <= 1;
  const hardNewsPenalty = lowNewsFeature ? (authorityMultiplier >= 1 ? 0.72 : 0.58) : 1;

  const adminFit = storyMatchesAudience(text, "admins") ? 1 : 0;
  const teacherFit = storyMatchesAudience(text, "teachers") ? 1 : 0;
  const edtechFit = storyMatchesAudience(text, "edtech") ? 1 : 0;
  const operatorFit = Math.min(1.2, adminFit * 0.75 + teacherFit * 0.35 + edtechFit * 0.35);
  const momentumBonus = 1 + Math.min(0.18, Math.max(0, recentCount - 1) * 0.05);
  const coverageBoost =
    independentSourceCount >= 4
      ? 1.45
      : independentSourceCount === 3
        ? 1.32
        : independentSourceCount === 2
          ? 1.16
          : 1;

  const base =
    impact * 2.6 +
    policyHits * 1.6 +
    urgency * 1.2 +
    relevance * 1.2 +
    volume * 0.9 +
    (familyDiversity * 1.4 + sourceDiversity * 0.3) +
    operatorFit +
    weeklyRecency;

  const score =
    base *
    authorityMultiplier *
    evergreenPenalty *
    singletonPenalty *
    singleSourcePenalty *
    thinCoveragePenalty *
    hardNewsPenalty *
    momentumBonus *
    coverageBoost;

  const whyRanked: NewsletterRankingReason[] = [];
  if (impact >= 2) whyRanked.push("high_impact");
  if (policyHits > 0) whyRanked.push("policy");
  if (urgency > 0 && (hoursSince <= 72 || recentCount >= 2)) whyRanked.push("urgent");
  if (independentSourceCount >= 2 || sourceCount >= 2) whyRanked.push("multi_source");
  if (adminFit > 0 && (impact > 0 || policyHits > 0)) whyRanked.push("district_impact");
  if (teacherFit > 0 && adminFit === 0) whyRanked.push("classroom_relevance");
  if (edtechFit > 0) whyRanked.push("edtech");
  if (recentCount >= 3 || inputs.articleCount >= 4) whyRanked.push("momentum");
  if (whyRanked.length === 0) whyRanked.push("high_impact");

  return {
    score: Number(score.toFixed(2)),
    storyType,
    urgencyOverride,
    whyRanked: whyRanked.slice(0, 3),
    breakdown: {
      impact,
      urgency,
      policyHits,
      relevance,
      volume: Number(volume.toFixed(2)),
      sourceDiversity: Number(sourceDiversity.toFixed(2)),
      familyDiversity: Number(familyDiversity.toFixed(2)),
      weeklyRecency: Number(weeklyRecency.toFixed(2)),
      operatorFit: Number(operatorFit.toFixed(2)),
      avgWeight: Number(baseWeight.toFixed(2)),
      authorityMultiplier: Number(authorityMultiplier.toFixed(2)),
      momentumBonus: Number(momentumBonus.toFixed(2)),
      coverageBoost: Number(coverageBoost.toFixed(2)),
      evergreenPenalty: Number(evergreenPenalty.toFixed(2)),
      singletonPenalty: Number(singletonPenalty.toFixed(2)),
      singleSourcePenalty: Number(singleSourcePenalty.toFixed(2)),
      thinCoveragePenalty: Number(thinCoveragePenalty.toFixed(2)),
      hardNewsPenalty: Number(hardNewsPenalty.toFixed(2)),
      hoursSince: Number(hoursSince.toFixed(2))
    }
  };
}

export function scoreStory(inputs: RankingInputs) {
  return analyzeStoryRanking(inputs).score;
}
