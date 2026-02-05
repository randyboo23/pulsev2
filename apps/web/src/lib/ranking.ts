type RankingInputs = {
  title: string;
  summary: string | null;
  articleCount: number;
  avgWeight: number;
  latestAt: Date;
};

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

function countHits(text: string, terms: string[]) {
  const lowered = text.toLowerCase();
  return terms.reduce((count, term) => (lowered.includes(term) ? count + 1 : count), 0);
}

export function scoreStory(inputs: RankingInputs) {
  const text = `${inputs.title} ${inputs.summary ?? ""}`;
  const impact = Math.min(countHits(text, KEYWORDS.impact), 3);
  const urgency = Math.min(countHits(text, KEYWORDS.urgency), 3);
  const novelty = Math.min(countHits(text, KEYWORDS.novelty), 3);
  const relevance = Math.min(countHits(text, KEYWORDS.relevance), 3);

  const volume = Math.log1p(inputs.articleCount);
  const hoursSince = (Date.now() - inputs.latestAt.getTime()) / (1000 * 60 * 60);
  const recencyBoost = 0.6 + 0.4 * Math.exp(-hoursSince / 48);

  const base =
    impact * 2.0 +
    urgency * 1.5 +
    novelty * 1.2 +
    relevance * 1.0 +
    volume * 0.8;

  const score = base * inputs.avgWeight * recencyBoost;

  return Number(score.toFixed(2));
}
