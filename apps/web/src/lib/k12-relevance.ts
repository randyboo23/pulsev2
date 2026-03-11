export type K12SignalInput = {
  title?: string | null;
  summary?: string | null;
  url?: string | null;
};

const K12_EXPLICIT_PATTERN =
  /\b(k-?12|pre-?k|public school(?:s)?|school district(?:s)?|district school(?:s)?|school board(?:s)?|superintendent(?:s)?|elementary school(?:s)?|middle school(?:s)?|high school(?:s)?|charter school(?:s)?|board of education|department of education|dept\.?\s+of education|state education agency)\b/i;

const K12_STRONG_SIGNAL_PATTERNS = [
  K12_EXPLICIT_PATTERN,
  /\b(classroom(?:s)?|curriculum|literacy|attendance|absenteeism|assessment|special education|student(?:s)? with disabilities|english learners?|graduation rates?|school safety|weapons detection|school meals?|school breakfast|school lunch|school supplies|voucher(?:s)?|esa|teacher pay|teacher shortage|student data privacy|school cybersecurity|edtech|education technology)\b/i,
  /\b(school principal(?:s)?|school closure(?:s)?|school reopening|school accountability|school funding|district budget|district operations|curriculum adoption|teacher pipeline|principal pipeline)\b/i,
  /\b(ai in education|ai in classrooms?|digital learning|instructional materials?)\b/i
] as const;

const SCHOOL_CONTEXT_PATTERN =
  /\b(school|schools|district|districts|classroom|classrooms|student(?:s)?|teacher(?:s)?)\b.{0,50}\b(board|budget|funding|policy|law|lawsuit|curriculum|assessment|accountability|attendance|absenteeism|literacy|math|meal|safety|superintendent|voucher|special education|iep|graduation|english learners?)\b|\b(board|budget|funding|policy|law|lawsuit|curriculum|assessment|accountability|attendance|absenteeism|literacy|math|meal|safety|superintendent|voucher|special education|iep|graduation|english learners?)\b.{0,50}\b(school|schools|district|districts|classroom|classrooms|student(?:s)?|teacher(?:s)?)\b/i;

const HIGHER_ED_ONLY_PATTERN =
  /\b(college|colleges|teachers college|university|universities|university system|state university|state universities|cal state|campus|campuses|undergraduate|graduate school|graduate schools|fraternity|sorority|ncaa|ivy league|community college|community colleges|college athletics|pell grant|degrees?|credential(?:s)?)\b/i;

const K12_HIGHER_ED_OVERRIDE_PATTERN =
  /\b(k-?12|teacher prep|educator prep|school district|public school|principal pipeline|teacher pipeline|teacher residency)\b/i;

const EVENT_LISTING_PATTERN =
  /\b(virtual information session|info(?:rmation)? session|webinar|register now|register today|join us for|eventbrite|tickets?\b|session \||conference\s+\d{4}|summit\s+\d{4}|workshop\s+\d{4})\b/i;

const SPORTS_PATTERN =
  /\b(nfl|nba|mlb|nhl|formula 1|grand prix|quarterback|receiver|running back|trade with the|touchdown|goalkeeper|race weekend|aston martin)\b/i;

const INTERNATIONAL_CONFLICT_PATTERN =
  /\b(airstrike|ceasefire|missile|iranian|gaza|ukraine|israel|military strike|foreign ministry)\b/i;

const NON_ACTIONABLE_CRIME_PATTERN =
  /\b(pornographic images|sexual exploitation|tricking hundreds of teens|prank gone wrong|teacher was killed|teacher is dead|brought to us)\b/i;

const SYSTEMIC_CRIME_CONTEXT_PATTERN =
  /\b(district|school board|superintendent|policy|law|lawsuit|security|safety plan|weapons detection|state education|department of education|board of education)\b/i;

function normalizedText(input: K12SignalInput) {
  return `${input.title ?? ""} ${input.summary ?? ""} ${input.url ?? ""}`
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function countMatches(text: string, patterns: readonly RegExp[]) {
  let hits = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) hits += 1;
  }
  return hits;
}

function assessK12Topic(input: K12SignalInput) {
  const text = normalizedText(input);
  if (!text) {
    return {
      text,
      explicit: false,
      strongSignals: 0,
      schoolContext: false,
      higherEdOnly: false,
      eventListing: false,
      sports: false,
      internationalConflict: false,
      nonActionableCrime: false
    };
  }

  const explicit = K12_EXPLICIT_PATTERN.test(text);
  const strongSignals = countMatches(text, K12_STRONG_SIGNAL_PATTERNS);
  const schoolContext = SCHOOL_CONTEXT_PATTERN.test(text);
  const higherEdOnly =
    HIGHER_ED_ONLY_PATTERN.test(text) && !K12_HIGHER_ED_OVERRIDE_PATTERN.test(text);
  const eventListing = EVENT_LISTING_PATTERN.test(text);
  const sports = SPORTS_PATTERN.test(text);
  const internationalConflict = INTERNATIONAL_CONFLICT_PATTERN.test(text);
  const nonActionableCrime =
    NON_ACTIONABLE_CRIME_PATTERN.test(text) && !SYSTEMIC_CRIME_CONTEXT_PATTERN.test(text);

  return {
    text,
    explicit,
    strongSignals,
    schoolContext,
    higherEdOnly,
    eventListing,
    sports,
    internationalConflict,
    nonActionableCrime
  };
}

export function hasK12TopicSignal(input: K12SignalInput) {
  const assessment = assessK12Topic(input);
  if (!assessment.text) return false;
  if (assessment.higherEdOnly || assessment.eventListing || assessment.sports || assessment.internationalConflict) {
    return false;
  }
  if (assessment.nonActionableCrime && !assessment.explicit) return false;
  if (assessment.explicit) return true;
  return assessment.strongSignals >= 1 || assessment.schoolContext;
}

export function hasStrictK12TopicSignal(input: K12SignalInput) {
  const assessment = assessK12Topic(input);
  if (!assessment.text) return false;
  if (
    assessment.higherEdOnly ||
    assessment.eventListing ||
    assessment.sports ||
    assessment.internationalConflict ||
    assessment.nonActionableCrime
  ) {
    return false;
  }
  if (assessment.explicit) return true;
  return assessment.strongSignals >= 1 || assessment.schoolContext;
}

export function isClearlyOffTopicForK12(input: K12SignalInput) {
  const assessment = assessK12Topic(input);
  return (
    assessment.higherEdOnly ||
    assessment.eventListing ||
    assessment.sports ||
    assessment.internationalConflict ||
    assessment.nonActionableCrime
  );
}
