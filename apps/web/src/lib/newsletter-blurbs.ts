import "server-only";

import type {
  NewsletterDraftSelection,
  NewsletterGeneratedBlurb
} from "@pulse/core";
import { pool } from "@/src/lib/db";

const NEWSLETTER_BLURB_SYSTEM_PROMPT = `You are a newsletter writer for PulseK12, a weekly newsletter for K-12 education leaders.

Editorial philosophy:
- PulseK12 sits at the intersection of research, practice, and policy
- Research is chosen for implications, not novelty
- Practitioner voices matter as much as data
- Favor credible, field-connected outlets over trend-chasing blogs
- Health, attendance, and wellness are instructional issues

Voice and style guidelines:
- Write like a smart insider briefing a colleague
- Lead sentences with the actor or subject
- Use specific numbers when available
- Never start sentences with "However," "Additionally," "Furthermore," or "Moreover"
- No filler or hedging
- End with implication, not instruction
- No exclamation points
- For research stories, lead with what it means for schools

Return exactly this format:
HEADLINE: ...
SUMMARY: ...`;

type ManualUrlContextRow = {
  url: string;
  title: string | null;
  summary: string | null;
  source_name: string | null;
};

type NewsletterBlurbContext = {
  url: string;
  title: string | null;
  sourceName: string | null;
  contextText: string;
};

function stripTags(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function sanitizeText(text: string, maxChars = 800) {
  if (!text) return "";
  return decodeEntities(stripTags(text))
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, " ")
    .trim()
    .slice(0, maxChars)
    .trim();
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeUrl(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function fallbackSourceName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "Unknown source";
  }
}

function extractMetaContent(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const rawValue = match?.[3] ?? match?.[1] ?? "";
    if (rawValue) {
      const cleaned = sanitizeText(rawValue, 240);
      if (cleaned) return cleaned;
    }
  }
  return "";
}

function extractHtmlTitle(html: string) {
  return (
    extractMetaContent(html, [
      /<meta[^>]*property=(["'])og:title\1[^>]*content=(["'])([\s\S]*?)\2[^>]*>/i,
      /<meta[^>]*name=(["'])twitter:title\1[^>]*content=(["'])([\s\S]*?)\2[^>]*>/i
    ]) ||
    (() => {
      const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return sanitizeText(match?.[1] ?? "", 180);
    })()
  );
}

function extractMetaDescription(html: string) {
  return extractMetaContent(html, [
    /<meta[^>]*name=(["'])description\1[^>]*content=(["'])([\s\S]*?)\2[^>]*>/i,
    /<meta[^>]*property=(["'])og:description\1[^>]*content=(["'])([\s\S]*?)\2[^>]*>/i,
    /<meta[^>]*name=(["'])twitter:description\1[^>]*content=(["'])([\s\S]*?)\2[^>]*>/i
  ]);
}

function extractParagraphs(html: string) {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const searchHtml = articleMatch?.[1] ?? html;
  const paragraphs = searchHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
  return paragraphs
    .map((paragraph) => sanitizeText(paragraph, 400))
    .filter((paragraph) => paragraph.length >= 50)
    .slice(0, 3);
}

async function fetchHtmlViaHttp(url: string, maxChars = 200_000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PulseBot/1.0; +https://pulse-k12.com)",
        Accept: "text/html"
      },
      redirect: "follow",
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return "";
    const html = await response.text();
    return html.slice(0, maxChars);
  } catch {
    return "";
  }
}

function parseBlurbResponse(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.toUpperCase() === "UNUSABLE") return null;

  let headline = "";
  let summary = "";
  let currentField: "headline" | "summary" | null = null;
  let currentContent: string[] = [];

  const commitField = () => {
    if (!currentField || currentContent.length === 0) return;
    const value = currentContent.join(" ").replace(/\s+/g, " ").trim();
    if (currentField === "headline") headline = value;
    if (currentField === "summary") summary = value;
  };

  for (const rawLine of trimmed.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^headline:/i.test(line)) {
      commitField();
      currentField = "headline";
      currentContent = [line.replace(/^headline:\s*/i, "").trim()];
      continue;
    }
    if (/^summary:/i.test(line)) {
      commitField();
      currentField = "summary";
      currentContent = [line.replace(/^summary:\s*/i, "").trim()];
      continue;
    }
    if (currentField) currentContent.push(line);
  }

  commitField();
  headline = headline.trim();
  summary = summary.trim();
  if (!headline || !summary) return null;
  return { headline, summary };
}

async function fetchAnthropicBlurb(context: NewsletterBlurbContext) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { headline: null, summary: null, error: "ANTHROPIC_API_KEY is not configured." };
  }

  const modelCandidates = [
    process.env.ANTHROPIC_MODEL,
    "claude-sonnet-4-5-20250929",
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest"
  ].filter(Boolean) as string[];

  const prompt = `Draft a PulseK12 newsletter blurb from this source material.

ARTICLE TITLE: ${context.title ?? "Untitled"}
SOURCE: ${context.sourceName ?? "Unknown source"}
URL: ${context.url}

SOURCE MATERIAL:
${context.contextText.slice(0, 5000)}

Requirements:
- HEADLINE must be 5-10 words, action-oriented, and specific.
- SUMMARY must be exactly 3 sentences in one paragraph.
- Use only the source material.
- Include specific numbers when available.
- Do not use bullets.
- If the source material is too thin to write accurately, respond with exactly: UNUSABLE`;

  for (const model of modelCandidates) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.2,
        system: NEWSLETTER_BLURB_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      if (response.status === 404) continue;
      const suffix =
        response.status === 401 || response.status === 403
          ? " Check the Anthropic API key."
          : "";
      return {
        headline: null,
        summary: null,
        error: `Anthropic returned ${response.status}.${suffix}`.trim()
      };
    }

    const payload = await response.json();
    const text = payload?.content?.[0]?.text;
    if (!text || typeof text !== "string") {
      return { headline: null, summary: null, error: "Anthropic returned an empty response." };
    }

    const parsed = parseBlurbResponse(text);
    if (!parsed) {
      return {
        headline: null,
        summary: null,
        error: "Anthropic did not return a usable HEADLINE/SUMMARY pair."
      };
    }

    return { headline: parsed.headline, summary: parsed.summary, error: null };
  }

  return {
    headline: null,
    summary: null,
    error: "No compatible Anthropic model was available for newsletter blurbs."
  };
}

async function loadManualUrlContext(url: string): Promise<NewsletterBlurbContext | null> {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;

  const dbResult = await pool.query<ManualUrlContextRow>(
    `select a.url, a.title, a.summary, s.name as source_name
     from articles a
     left join sources s on s.id = a.source_id
     where a.url = $1
     order by a.fetched_at desc
     limit 1`,
    [normalizedUrl]
  );

  const dbRow = dbResult.rows[0];
  if (dbRow) {
    const title = normalizeOptionalText(dbRow.title);
    const summary = normalizeOptionalText(dbRow.summary);
    if (title || summary) {
      return {
        url: normalizedUrl,
        title,
        sourceName: normalizeOptionalText(dbRow.source_name) ?? fallbackSourceName(normalizedUrl),
        contextText: [title, summary].filter(Boolean).join("\n\n")
      };
    }
  }

  const html = await fetchHtmlViaHttp(normalizedUrl);
  if (!html) return null;

  const title = normalizeOptionalText(extractHtmlTitle(html));
  const description = normalizeOptionalText(extractMetaDescription(html));
  const paragraphs = extractParagraphs(html);
  const contextText = [description, ...paragraphs].filter(Boolean).join("\n\n").trim();
  if (!title && !contextText) return null;

  return {
    url: normalizedUrl,
    title,
    sourceName: fallbackSourceName(normalizedUrl),
    contextText
  };
}

function createStoryBlurbResult(
  selection: NewsletterDraftSelection,
  generatedAt: string,
  result: { headline: string | null; summary: string | null; error: string | null }
): NewsletterGeneratedBlurb {
  return {
    key: buildNewsletterDraftBlurbKey("story", selection.story_id),
    kind: "story",
    story_id: selection.story_id,
    published_rank: selection.published_rank,
    url: selection.source_url ?? "",
    title: selection.title,
    source_name: selection.source_name,
    headline: result.headline,
    summary: result.summary,
    error: result.error,
    generated_at: generatedAt
  };
}

function createManualBlurbResult(
  url: string,
  generatedAt: string,
  params: {
    title: string | null;
    sourceName: string | null;
    headline: string | null;
    summary: string | null;
    error: string | null;
  }
): NewsletterGeneratedBlurb {
  return {
    key: buildNewsletterDraftBlurbKey("manual", url),
    kind: "manual",
    story_id: null,
    published_rank: null,
    url,
    title: params.title,
    source_name: params.sourceName,
    headline: params.headline,
    summary: params.summary,
    error: params.error,
    generated_at: generatedAt
  };
}

export function buildNewsletterDraftBlurbKey(kind: "story" | "manual", value: string) {
  return `${kind}:${value}`;
}

export async function generateNewsletterDraftBlurbs(params: {
  selected: NewsletterDraftSelection[];
  manualAddUrls: string[];
}) {
  const generatedAt = new Date().toISOString();
  const results: NewsletterGeneratedBlurb[] = [];

  const selected = [...params.selected].sort(
    (left, right) => left.published_rank - right.published_rank || left.story_id.localeCompare(right.story_id)
  );
  for (const selection of selected) {
    const contextText = [selection.summary, selection.title].filter(Boolean).join("\n\n").trim();
    if (!contextText || contextText.length < 40) {
      results.push(
        createStoryBlurbResult(selection, generatedAt, {
          headline: null,
          summary: null,
          error: "This story does not have enough saved context to generate a blurb yet."
        })
      );
      continue;
    }

    const generated = await fetchAnthropicBlurb({
      url: selection.source_url ?? "",
      title: selection.title,
      sourceName: selection.source_name,
      contextText
    });
    results.push(createStoryBlurbResult(selection, generatedAt, generated));
  }

  for (const rawUrl of params.manualAddUrls) {
    const normalizedUrl = normalizeUrl(rawUrl);
    if (!normalizedUrl) {
      results.push(
        createManualBlurbResult(rawUrl, generatedAt, {
          title: null,
          sourceName: null,
          headline: null,
          summary: null,
          error: "This manual URL is not a valid http(s) link."
        })
      );
      continue;
    }

    const context = await loadManualUrlContext(normalizedUrl);
    if (!context || !context.contextText || context.contextText.length < 40) {
      results.push(
        createManualBlurbResult(normalizedUrl, generatedAt, {
          title: context?.title ?? null,
          sourceName: context?.sourceName ?? fallbackSourceName(normalizedUrl),
          headline: null,
          summary: null,
          error: "Could not fetch enough article text from this URL to draft a reliable blurb."
        })
      );
      continue;
    }

    const generated = await fetchAnthropicBlurb(context);
    results.push(
      createManualBlurbResult(normalizedUrl, generatedAt, {
        title: context.title,
        sourceName: context.sourceName,
        headline: generated.headline,
        summary: generated.summary,
        error: generated.error
      })
    );
  }

  return results;
}
