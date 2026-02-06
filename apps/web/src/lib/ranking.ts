export type RankingInputs = {
  title: string;
  summary: string | null;
  articleCount: number;
  sourceCount?: number;
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
  recency: number;
  avgWeight: number;
  authorityMultiplier: number;
  evergreenPenalty: number;
  singletonPenalty: number;
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

export function storyMatchesAudience(text: string, audience: Audience) {
  const terms = AUDIENCE_KEYWORDS[audience] ?? [];
  const lowered = text.toLowerCase();
  return terms.some((term) => lowered.includes(term));
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
  const recentCount = Number.isFinite(inputs.recentCount ?? 0) ? Number(inputs.recentCount ?? 0) : 0;
  const volume = Math.log1p(inputs.articleCount);
  const sourceDiversity = Math.log1p(Math.max(0, sourceCount));
  const hoursSince = (Date.now() - inputs.latestAt.getTime()) / (1000 * 60 * 60);
  const recency = 1.1 * Math.exp(-hoursSince / 30);
  const weakEvergreenSignals = hoursSince > 18 && sourceCount <= 1 && recentCount <= 1;
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
    sourceCount <= 1 && recentCount <= 1 && inputs.articleCount <= 1 && authorityMultiplier < 1;
  const singletonPenalty = !urgencyOverride && lowAuthoritySingleton ? 0.75 : 1;
  const thinCoveragePenalty =
    !urgencyOverride &&
    storyType !== "breaking" &&
    sourceCount <= 1 &&
    recentCount <= 1 &&
    inputs.articleCount <= 1
      ? 0.82
      : 1;
  const lowNewsFeature =
    storyType === "feature" &&
    !urgencyOverride &&
    hardNewsSignals === 0 &&
    sourceCount <= 2 &&
    recentCount <= 1;
  const hardNewsPenalty = lowNewsFeature ? (authorityMultiplier >= 1 ? 0.6 : 0.45) : 1;

  const base =
    impact * 2.2 +
    urgency * 1.8 +
    novelty * 1.0 +
    relevance * 1.3 +
    volume * 0.9 +
    sourceDiversity * 0.7 +
    recency;

  const score =
    base *
    authorityMultiplier *
    evergreenPenalty *
    singletonPenalty *
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
      recency: Number(recency.toFixed(2)),
      avgWeight: Number(baseWeight.toFixed(2)),
      authorityMultiplier: Number(authorityMultiplier.toFixed(2)),
      evergreenPenalty: Number(evergreenPenalty.toFixed(2)),
      singletonPenalty: Number(singletonPenalty.toFixed(2)),
      thinCoveragePenalty: Number(thinCoveragePenalty.toFixed(2)),
      hardNewsPenalty: Number(hardNewsPenalty.toFixed(2)),
      lowNewsFeature,
      lowAuthoritySingleton,
      weakEvergreenSignals,
      hoursSince: Number(hoursSince.toFixed(2))
    }
  };
}

export function scoreStory(inputs: RankingInputs) {
  return analyzeStoryRanking(inputs).score;
}
