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
  novelty: number;
  relevance: number;
  volume: number;
  sourceDiversity: number;
  recency: number;
  avgWeight: number;
  evergreenPenalty: number;
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

function countHits(text: string, terms: string[]) {
  const lowered = text.toLowerCase();
  return terms.reduce((count, term) => (lowered.includes(term) ? count + 1 : count), 0);
}

function classifyStoryType(text: string, weakEvergreenSignals: boolean): StoryType {
  if (countHits(text, OPINION_HINTS) > 0) return "opinion";

  const breakingHits = countHits(text, BREAKING_HINTS);
  if (breakingHits > 0) return "breaking";

  const policyHits = countHits(text, POLICY_HINTS);
  if (policyHits > 0) return "policy";

  const evergreenHits = countHits(text, EVERGREEN_HINTS);
  if (evergreenHits > 0 && weakEvergreenSignals) return "evergreen";

  return "feature";
}

export function analyzeStoryRanking(inputs: RankingInputs): StoryRankingAnalysis {
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
  const weightMultiplier = Math.max(0.75, Math.min(1.25, inputs.avgWeight));

  const base =
    impact * 2.2 +
    urgency * 1.8 +
    novelty * 1.0 +
    relevance * 1.0 +
    volume * 0.9 +
    sourceDiversity * 0.7 +
    recency;

  const score = base * weightMultiplier * evergreenPenalty;

  let leadEligible = true;
  let leadReason: string | null = null;

  if (storyType === "evergreen" && !urgencyOverride) {
    leadEligible = false;
    leadReason = "evergreen_weak_signal";
  } else if (storyType === "opinion" && !urgencyOverride) {
    leadEligible = false;
    leadReason = "opinion_demoted";
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
      avgWeight: Number(weightMultiplier.toFixed(2)),
      evergreenPenalty: Number(evergreenPenalty.toFixed(2)),
      weakEvergreenSignals,
      hoursSince: Number(hoursSince.toFixed(2))
    }
  };
}

export function scoreStory(inputs: RankingInputs) {
  return analyzeStoryRanking(inputs).score;
}
