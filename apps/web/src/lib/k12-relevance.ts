export type K12SignalInput = {
  title?: string | null;
  summary?: string | null;
  url?: string | null;
};

const K12_EXPLICIT_PATTERN =
  /\b(k-?12|pre-?k|public school(?:s)?|school district(?:s)?|district school(?:s)?|school board(?:s)?|superintendent(?:s)?|elementary school(?:s)?|middle school(?:s)?|high school(?:s)?|charter school(?:s)?|board of education|department of education|dept\.?\s+of education|state education agency)\b/i;

const K12_SUPPORTING_PATTERN =
  /\b(education|teacher(?:s)?|classroom(?:s)?|curriculum|literacy|attendance|absenteeism|assessment|special education|edtech|school safety)\b/i;

const SCHOOL_CONTEXT_PATTERN =
  /\b(school|schools)\b.{0,50}\b(district|board|student(?:s)?|teacher(?:s)?|curriculum|policy|law|lawsuit|superintendent|principal|classroom|education)\b|\b(district|board|student(?:s)?|teacher(?:s)?|curriculum|policy|law|lawsuit|superintendent|principal|classroom|education)\b.{0,50}\b(school|schools)\b/i;

const HIGHER_ED_ONLY_PATTERN =
  /\b(college|university|campus|undergraduate|graduate school|fraternity|sorority|ncaa|ivy league|community college)\b/i;

export function hasK12TopicSignal(input: K12SignalInput) {
  const text = `${input.title ?? ""} ${input.summary ?? ""} ${input.url ?? ""}`
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();

  if (!text) return false;
  if (K12_EXPLICIT_PATTERN.test(text)) return true;
  if (!K12_SUPPORTING_PATTERN.test(text) && !SCHOOL_CONTEXT_PATTERN.test(text)) return false;
  if (HIGHER_ED_ONLY_PATTERN.test(text)) return false;

  return true;
}
