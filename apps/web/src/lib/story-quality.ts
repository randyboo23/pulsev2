const NON_STORY_TITLE_PATTERNS = [
  /^privacy policy(?:[,:-].*)?$/i,
  /^terms(?: of (?:service|use|services|conditions))?$/i,
  /^cookie policy$/i,
  /^work with us$/i,
  /^about us$/i,
  /^contact us$/i,
  /^sitemap$/i,
  /^(?:all )?topics$/i,
  /^grade levels?$/i,
  /^north america$/i,
  /^politics\s*&\s*policy$/i,
  /^(?:the\s+)?state of the union$/i,
  /^(?:pre[-\s]?k|pk|k|\d{1,2})\s*-\s*(?:\d{1,2}|12)\s+(?:primary|elementary|middle|high)\s+school$/i
];

const NON_STORY_PATH_PATTERNS = [
  /\/privacy(?:-policy)?(?:\/|$|\.)/i,
  /\/terms(?:-of-(?:service|use|services|conditions))?(?:\/|$|\.)/i,
  /\/cookie(?:-policy)?(?:\/|$|\.)/i,
  /\/work-with-us(?:\/|$|\.)/i,
  /\/about-us(?:\/|$|\.)/i,
  /\/contact-us(?:\/|$|\.)/i,
  /\/sitemap(?:\/|$|\.)/i,
  /\/tags?(?:\/|$|\.)/i,
  /\/grade-level(?:\/|-|$|\.)/i
];

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function isLikelyNonStoryTitle(title: string | null | undefined) {
  const normalized = normalizeText(title);
  if (!normalized) return false;

  if (NON_STORY_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const lowered = normalized.toLowerCase();
  const wordCount = lowered.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 6 && /^privacy policy\b/.test(lowered)) return true;
  if (wordCount <= 7 && /^terms of (service|use|services|conditions)\b/.test(lowered)) return true;
  return false;
}

export function isLikelyNonStoryPath(pathname: string | null | undefined) {
  const normalized = normalizeText(pathname).toLowerCase();
  if (!normalized) return false;
  return NON_STORY_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isLikelyNonStoryUrl(url: string | null | undefined) {
  const raw = normalizeText(url);
  if (!raw) return false;
  try {
    const pathname = new URL(raw).pathname;
    return isLikelyNonStoryPath(pathname);
  } catch {
    return false;
  }
}
