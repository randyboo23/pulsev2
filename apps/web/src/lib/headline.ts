const LOWER_EXCEPTIONS = new Set([
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

const KNOWN_CASING: Record<string, string> = {
  ak: "AK",
  al: "AL",
  ai: "AI",
  ap: "AP",
  ar: "AR",
  az: "AZ",
  ca: "CA",
  co: "CO",
  ct: "CT",
  cte: "CTE",
  dc: "DC",
  dei: "DEI",
  de: "DE",
  dpi: "DPI",
  dpscd: "DPSCD",
  ela: "ELA",
  ell: "ELL",
  esl: "ESL",
  edtech: "EdTech",
  fl: "FL",
  fy: "FY",
  ga: "GA",
  gop: "GOP",
  hi: "HI",
  ia: "IA",
  id: "ID",
  il: "IL",
  in: "IN",
  iep: "IEP",
  isd: "ISD",
  ks: "KS",
  ky: "KY",
  k12: "K-12",
  "k-12": "K-12",
  la: "LA",
  lausd: "LAUSD",
  lgbtq: "LGBTQ",
  lgbtqia: "LGBTQIA",
  lms: "LMS",
  ma: "MA",
  md: "MD",
  me: "ME",
  mi: "MI",
  mn: "MN",
  mo: "MO",
  ms: "MS",
  mt: "MT",
  mtss: "MTSS",
  naep: "NAEP",
  nc: "NC",
  nd: "ND",
  ne: "NE",
  nh: "NH",
  nj: "NJ",
  nm: "NM",
  nv: "NV",
  nyc: "NYC",
  ny: "NY",
  oh: "OH",
  ok: "OK",
  or: "OR",
  pa: "PA",
  pta: "PTA",
  ri: "RI",
  rti: "RTI",
  sc: "SC",
  sd: "SD",
  sat: "SAT",
  sel: "SEL",
  sf: "SF",
  stem: "STEM",
  steam: "STEAM",
  tn: "TN",
  tx: "TX",
  us: "US",
  "u.s": "U.S",
  "u.s.": "U.S.",
  ut: "UT",
  va: "VA",
  vt: "VT",
  wa: "WA",
  wi: "WI",
  wv: "WV",
  wy: "WY"
};

const SPECIAL_CASING: Record<string, string> = {
  mcmahon: "McMahon"
};

function splitWordShell(word: string) {
  const leadingMatch = word.match(/^\W+/);
  const trailingMatch = word.match(/\W+$/);
  const leading = leadingMatch ? leadingMatch[0] : "";
  const trailing = trailingMatch ? trailingMatch[0] : "";
  const core = word.slice(leading.length, word.length - trailing.length);
  return { leading, core, trailing };
}

function normalizeKnownCasing(part: string) {
  const lower = part.toLowerCase();
  return KNOWN_CASING[lower] ?? SPECIAL_CASING[lower] ?? null;
}

function titleCasePart(part: string, wordIndex: number, partIndex: number) {
  const lower = part.toLowerCase();
  if (partIndex === 0 && LOWER_EXCEPTIONS.has(lower)) {
    return wordIndex === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  }
  if (partIndex > 0 && LOWER_EXCEPTIONS.has(lower)) return lower;
  const known = normalizeKnownCasing(part);
  if (known) return known;

  const ordinal = lower.match(/^(\d+)(st|nd|rd|th)$/);
  if (ordinal) return `${ordinal[1]}${ordinal[2]}`;
  if (/^\d/.test(lower)) return lower.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCaseWord(word: string, wordIndex: number) {
  const { leading, core, trailing } = splitWordShell(word);
  if (!core) return word;
  const rebuilt = core
    .split("-")
    .map((part, partIndex) => titleCasePart(part, wordIndex, partIndex))
    .join("-");
  return `${leading}${rebuilt}${trailing}`;
}

function fixKnownCasingWord(word: string, wordIndex: number, words: string[]) {
  const { leading, core, trailing } = splitWordShell(word);
  if (!core) return word;
  const rebuilt = core
    .split("-")
    .map((part) => {
      const lower = part.toLowerCase();
      const known = normalizeKnownCasing(part);
      if (known) {
        const previousWord = words[wordIndex - 1] ?? "";
        const followsLocationComma = /,$/.test(previousWord);
        if (LOWER_EXCEPTIONS.has(lower) && !followsLocationComma) {
          return wordIndex === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
        }
        return known;
      }

      const ordinal = lower.match(/^(\d+)(st|nd|rd|th)$/);
      if (ordinal) return `${ordinal[1]}${ordinal[2]}`;
      const compactNumber = lower.match(/^(\$?\d+(?:\.\d+)?)([kmb])$/);
      if (compactNumber) return `${compactNumber[1]}${compactNumber[2].toUpperCase()}`;

      const letters = part.replace(/[^A-Za-z]/g, "");
      if (letters.length <= 2 && letters.length > 0 && letters === letters.toUpperCase()) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }

      return part;
    })
    .join("-");
  return `${leading}${rebuilt}${trailing}`;
}

function fixContextualCasing(title: string) {
  return title.replace(
    /\bIt\s+(Teams?|Departments?|Leaders?|Staff|Infrastructure|Security|Systems?|Services?|Budgets?|Directors?|Admins?|Administrators?|Operations?)\b/g,
    "IT $1"
  );
}

function shouldTitleCase(title: string) {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  const upperStartCount = words.filter((word) => /^[A-Z]/.test(word)).length;
  const lowerStartCount = words.filter((word) => {
    const { core } = splitWordShell(word);
    return /^[a-z]/.test(core);
  }).length;
  const allCapsWords = words.filter((word) => {
    const letters = word.replace(/[^A-Za-z]/g, "");
    return letters.length >= 3 && letters === letters.toUpperCase();
  }).length;
  const knownLowercaseAcronyms = words.filter((word) => {
    const { core } = splitWordShell(word);
    return Boolean(core && normalizeKnownCasing(core) && core === core.toLowerCase());
  }).length;

  if (!/[A-Z]/.test(title)) return true;
  if (upperStartCount < Math.max(2, words.length * 0.4)) return true;
  if (words.length >= 4 && lowerStartCount / words.length >= 0.4) return true;
  if (words.length >= 4 && allCapsWords / words.length >= 0.7) return true;
  return knownLowercaseAcronyms > 0;
}

export function normalizeHeadlineTitle(title: string | null | undefined) {
  const trimmed = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;

  const words = trimmed.split(/\s+/);
  if (shouldTitleCase(trimmed)) {
    return fixContextualCasing(words.map((word, index) => titleCaseWord(word, index)).join(" "));
  }

  return fixContextualCasing(words.map(fixKnownCasingWord).join(" "));
}
