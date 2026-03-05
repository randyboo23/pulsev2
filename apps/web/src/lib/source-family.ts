const DOMAIN_FAMILY_ALIASES: Record<string, string> = {
  "educationweek.org": "educationweek.org",
  "edweek.org": "educationweek.org",
  "nytimes.com": "nytimes.com",
  "washingtonpost.com": "washingtonpost.com",
  "apnews.com": "apnews.com",
  "reuters.com": "reuters.com"
};

const MULTIPART_TLDS = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "com.au",
  "co.jp",
  "com.br",
  "com.mx"
]);

function normalizeDomain(domain: string | null | undefined) {
  return String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

function registrableDomain(domain: string) {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length <= 2) return domain;

  const lastTwo = parts.slice(-2).join(".");
  if (MULTIPART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }

  return lastTwo;
}

export function sourceFamilyFromDomain(domain: string | null | undefined) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return "";
  const alias = DOMAIN_FAMILY_ALIASES[normalized];
  if (alias) return alias;
  return registrableDomain(normalized);
}

export function countSourceFamilies(domains: Array<string | null | undefined>) {
  const families = new Set<string>();
  for (const domain of domains) {
    const family = sourceFamilyFromDomain(domain);
    if (!family) continue;
    families.add(family);
  }
  return families.size;
}
