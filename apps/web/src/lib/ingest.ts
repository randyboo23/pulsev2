import Parser from "rss-parser";
import { pool } from "./db";
import { getFeedUrls } from "./feeds";
import { TRUSTED_SITES, SOURCE_TIERS } from "@pulse/core";
import { groupUngroupedArticles } from "./grouping";

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "PulseK12/1.0 (+https://pulsek12.com)"
  }
});

const MAX_ITEMS_PER_FEED = 100;
const DOWNWEIGHT_PATTERNS = ["edtechinnovationhub", "ethi"];

const US_INDICATORS = [
  "united states",
  "u.s.",
  "usa",
  "district of columbia",
  "washington, dc",
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington state",
  "west virginia",
  "wisconsin",
  "wyoming"
];

const NON_US_INDICATORS = [
  "jordan",
  "canada",
  "ontario",
  "british columbia",
  "uk",
  "united kingdom",
  "england",
  "scotland",
  "wales",
  "ireland",
  "australia",
  "new zealand",
  "india",
  "china",
  "japan",
  "korea",
  "singapore",
  "uae",
  "saudi",
  "qatar",
  "brazil",
  "mexico",
  "france",
  "germany",
  "spain",
  "italy",
  "netherlands",
  "sweden",
  "norway",
  "finland",
  "denmark",
  "belgium",
  "switzerland",
  "austria",
  "poland",
  "czech",
  "slovakia",
  "hungary",
  "romania",
  "bulgaria",
  "greece",
  "turkey",
  "israel",
  "palestine",
  "gaza",
  "ukraine",
  "russia",
  "nigeria",
  "kenya",
  "south africa",
  "ghana",
  "egypt",
  "morocco",
  "algeria",
  "tunisia",
  "ethiopia",
  "pakistan",
  "bangladesh",
  "sri lanka",
  "nepal",
  "philippines",
  "indonesia",
  "malaysia",
  "thailand",
  "vietnam",
  "cambodia",
  "laos",
  "myanmar",
  "hong kong",
  "taiwan",
  "macau",
  "european union",
  "eu"
];

type IngestResult = {
  feeds: number;
  fetchedItems: number;
  inserted: number;
  updated: number;
  skipped: number;
  grouped: number;
  parseFailures: number;
};

function cleanTitle(title: string) {
  if (!title) return title;
  if (title.includes(" - ")) {
    return title.split(" - ").slice(0, -1).join(" - ").trim();
  }
  return title.trim();
}

function normalizeUrl(input: string) {
  try {
    const url = new URL(input);
    url.hash = "";
    const params = url.searchParams;
    for (const key of Array.from(params.keys())) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || lower === "gclid" || lower === "fbclid") {
        params.delete(key);
      }
    }
    return url.toString();
  } catch {
    return input;
  }
}

function getDomain(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace("www.", "").toLowerCase();
  } catch {
    return "";
  }
}

function isUSOnlyStory(title: string, summary: string) {
  const text = `${title} ${summary}`.toLowerCase();
  const hasUS = US_INDICATORS.some((term) => text.includes(term));
  const hasNonUS = NON_US_INDICATORS.some((term) => text.includes(term));
  return !(hasNonUS && !hasUS);
}

async function resolveGoogleNewsUrl(url: string) {
  if (!url.includes("news.google.com")) return url;
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent": "PulseK12/1.0 (+https://pulsek12.com)"
      }
    });
    return response.url || url;
  } catch {
    return url;
  }
}

async function ensureSource(
  name: string,
  domain: string,
  tierHint: "A" | "B" | "C" | "unknown"
) {
  if (!domain) return null;

  const existing = await pool.query(
    "select id from sources where domain = $1",
    [domain]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id as string;
  }

  const isTrusted = TRUSTED_SITES.includes(domain);
  const tier =
    tierHint !== "unknown"
      ? tierHint
      : SOURCE_TIERS.tierA.localJournalism.includes(domain) ||
          SOURCE_TIERS.tierA.stateEducation.includes(domain) ||
          SOURCE_TIERS.tierA.govPatterns.some((pattern) => domain.includes(pattern))
        ? "A"
        : SOURCE_TIERS.tierB.domains.includes(domain) ||
            SOURCE_TIERS.tierB.localTvPatterns.some((pattern) =>
              domain.includes(pattern)
            )
          ? "B"
          : SOURCE_TIERS.tierC.domains.includes(domain) ||
              SOURCE_TIERS.tierC.patterns.some((pattern) =>
                domain.includes(pattern)
              )
            ? "C"
            : "unknown";
  if (tier === "C") {
    return null;
  }

  let weight = isTrusted ? 1.2 : tier === "A" ? 1.1 : tier === "B" ? 1.0 : 0.9;
  if (DOWNWEIGHT_PATTERNS.some((pattern) => domain.includes(pattern))) {
    weight = Math.min(weight, 0.7);
  }

  const inserted = await pool.query(
    "insert into sources (name, domain, tier, weight) values ($1, $2, $3, $4) returning id",
    [name || domain, domain, tier, weight]
  );

  return inserted.rows[0].id as string;
}

export async function ingestFeeds(): Promise<IngestResult> {
  const feeds = getFeedUrls(7);
  let fetchedItems = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let parseFailures = 0;

  for (const feed of feeds) {
    let parsed;
    try {
      parsed = await parser.parseURL(feed.url);
    } catch (error) {
      parseFailures += 1;
      console.error(
        `[ingest] failed to parse feed ${feed.url}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    for (const item of parsed.items.slice(0, MAX_ITEMS_PER_FEED)) {
      fetchedItems += 1;

      const rawTitle = item.title ?? "";
      const title = cleanTitle(rawTitle);
      const link = item.link ?? "";
      if (!link || !title) {
        skipped += 1;
        continue;
      }

      const resolvedUrl = await resolveGoogleNewsUrl(link);
      const normalizedUrl = normalizeUrl(resolvedUrl);
      if (!normalizedUrl) {
        skipped += 1;
        continue;
      }

      const sourceDomain =
        feed.domain === "news.google.com" ? getDomain(normalizedUrl) : feed.domain;
      if (!sourceDomain) {
        skipped += 1;
        continue;
      }

      const sourceName =
        feed.domain === "news.google.com" ? sourceDomain : feed.sourceName;

      const sourceId = await ensureSource(sourceName, sourceDomain, feed.tier);
      if (!sourceId) {
        skipped += 1;
        continue;
      }
      const summary = item.contentSnippet ?? item.content ?? "";
      if (!isUSOnlyStory(title, summary)) {
        skipped += 1;
        continue;
      }
      const publishedAt = item.isoDate
        ? new Date(item.isoDate)
        : item.pubDate
          ? new Date(item.pubDate)
          : null;

      const result = await pool.query(
        `insert into articles (source_id, url, title, summary, published_at)
         values ($1, $2, $3, $4, $5)
         on conflict (url)
         do update set
           title = excluded.title,
           summary = case
             when excluded.summary is null or length(trim(excluded.summary)) = 0 then articles.summary
             when articles.summary is null or length(trim(articles.summary)) = 0 then excluded.summary
             when length(excluded.summary) > length(articles.summary) then excluded.summary
             else articles.summary
           end,
           published_at = excluded.published_at,
           updated_at = now()
         returning (xmax = 0) as inserted`,
        [sourceId, normalizedUrl, title, summary, publishedAt]
      );

      if (result.rows[0]?.inserted) {
        inserted += 1;
      } else {
        updated += 1;
      }
    }
  }

  const grouped = await groupUngroupedArticles();

  return {
    feeds: feeds.length,
    fetchedItems,
    inserted,
    updated,
    skipped,
    grouped,
    parseFailures
  };
}
