import { TRUSTED_SITES } from "@pulse/core";

export type FeedConfig = {
  name: string;
  query: string;
};

export type FeedEntry = {
  id?: string;
  url: string;
  sourceName: string;
  domain: string;
  tier: "A" | "B" | "C" | "unknown";
  isActive?: boolean;
  feedType?: "rss" | "discovery" | "scrape";
};

const SITE_FILTER = TRUSTED_SITES.map((site) => `site:${site}`).join(" OR ");

const SEARCH_QUERIES: FeedConfig[] = [
  {
    name: "AI & EdTech",
    query:
      '"AI in education" OR "artificial intelligence schools" OR "edtech" OR "education technology trends"'
  },
  {
    name: "Policy & Legislation",
    query:
      '"K-12 policy" OR "education legislation" OR "school funding" OR "education budget"'
  },
  {
    name: "Teaching & Instruction",
    query:
      '"instructional strategies" OR "teacher professional development" OR "learning gaps" OR "math instruction" OR "literacy"'
  },
  {
    name: "Safety & Privacy",
    query:
      '"school safety technology" OR "student data privacy" OR "education cybersecurity" OR "student behavior policy"'
  },
  {
    name: "Student Wellness",
    query:
      '"chronic absenteeism" OR "student mental health" OR "MTSS" OR "school attendance" OR "SEL"'
  },
  {
    name: "General K-12",
    query: `"K-12 education" OR "public schools" OR "school districts" (${SITE_FILTER})`
  }
];

const CURATED_RSS_FEEDS: FeedEntry[] = [
  {
    url: "https://www.the74million.org/feed/",
    sourceName: "The 74",
    domain: "the74million.org",
    tier: "B",
    feedType: "rss"
  },
  {
    url: "https://hechingerreport.org/feed/",
    sourceName: "Hechinger Report",
    domain: "hechingerreport.org",
    tier: "B",
    feedType: "rss"
  },
  {
    url: "https://www.edsurge.com/news",
    sourceName: "EdSurge",
    domain: "edsurge.com",
    tier: "B",
    feedType: "scrape"
  },
  {
    url: "https://www.k12dive.com/",
    sourceName: "K-12 Dive",
    domain: "k12dive.com",
    tier: "B",
    feedType: "scrape"
  },
  {
    url: "https://edsource.org/feed",
    sourceName: "EdSource",
    domain: "edsource.org",
    tier: "A",
    feedType: "rss"
  },
  {
    url: "https://www.ednc.org/feed/",
    sourceName: "EdNC",
    domain: "ednc.org",
    tier: "A",
    feedType: "rss"
  },
  {
    url: "https://www.eschoolnews.com/feed/",
    sourceName: "eSchool News",
    domain: "eschoolnews.com",
    tier: "B",
    feedType: "rss"
  },
  {
    url: "https://districtadministration.com/feed/",
    sourceName: "District Administration",
    domain: "districtadministration.com",
    tier: "B",
    feedType: "rss"
  },
  {
    url: "https://edtechmagazine.com/k12/rss.xml",
    sourceName: "EdTech Magazine",
    domain: "edtechmagazine.com",
    tier: "B",
    feedType: "rss"
  },
  {
    url: "https://www.edutopia.org/",
    sourceName: "Edutopia",
    domain: "edutopia.org",
    tier: "B",
    feedType: "scrape"
  },
  {
    url: "https://www.educationnext.org/feed/",
    sourceName: "Education Next",
    domain: "educationnext.org",
    tier: "unknown",
    feedType: "rss"
  },
  {
    url: "https://www.brookings.edu/topic/education/",
    sourceName: "Brookings Education",
    domain: "brookings.edu",
    tier: "B",
    feedType: "scrape"
  },
  {
    url: "https://www.rand.org/topics/education-and-literacy.html",
    sourceName: "RAND Education",
    domain: "rand.org",
    tier: "B",
    feedType: "scrape"
  },
  {
    url: "https://www.kqed.org/education",
    sourceName: "KQED Education",
    domain: "kqed.org",
    tier: "B",
    feedType: "scrape"
  },
  {
    url: "https://www.chalkbeat.org/",
    sourceName: "Chalkbeat",
    domain: "chalkbeat.org",
    tier: "B",
    feedType: "scrape"
  }
];

export function buildGoogleNewsRssUrl(query: string, daysBack = 7) {
  const baseUrl = "https://news.google.com/rss/search";
  const fullQuery = `${query} when:${daysBack}d`;
  const params = new URLSearchParams({
    q: fullQuery,
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  });
  return `${baseUrl}?${params.toString()}`;
}

export function getDefaultFeeds(daysBack = 7): FeedEntry[] {
  const discoveryFeeds = SEARCH_QUERIES.map((feed) => ({
    url: buildGoogleNewsRssUrl(feed.query, daysBack),
    sourceName: `Google News: ${feed.name}`,
    domain: "news.google.com",
    tier: "unknown" as const,
    feedType: "discovery" as const,
    isActive: true
  }));

  return [...CURATED_RSS_FEEDS, ...discoveryFeeds];
}
