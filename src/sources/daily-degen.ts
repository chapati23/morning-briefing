/**
 * Daily Degen News Source
 *
 * Scrapes the "Important News and Analysis" section from
 * The Daily Degen Substack newsletter and returns curated
 * crypto news as briefing items with tweet links.
 */

import * as cheerio from "cheerio";
import type { BriefingItem, BriefingSection, DataSource } from "../types";
import { withCache } from "../utils";

// ============================================================================
// Configuration
// ============================================================================

const SUBSTACK_API =
  "https://thedailydegen.substack.com/api/v1/posts?limit=1&offset=0";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const SECTION_HEADING = "Important News And Analysis";

/**
 * Items matching any of these patterns are filtered out (videos, podcasts,
 * episodes, livestreams, interviews, motivational fluff).
 */
const SKIP_PATTERNS: readonly RegExp[] = [
  /^new .+ interview/i,
  /^new interview/i,
  /^new .+ video/i,
  /^another new .+ video/i,
  /^new video/i,
  /^video .+ published/i,
  /^new .+ podcast/i,
  /^new podcast/i,
  /^new roundtable/i,
  /^new .+ roundtable/i,
  /^new pomp/i,
  /^new .+ guide/i,
  /^weekly .+ overview/i,
  /parting wisdom/i,
  /chase your dreams/i,
  /don't forget to/i,
  // Episode and livestream content (e.g. "New Cheeky Pint episode from Stripe",
  // "New episode of @thebellcurvepod featuring ...",
  // "Yesterday's livestream from @theollupco")
  /^new .+ episode/i,
  /^new episode/i,
  /\blivestrea/i,
  // "New discussion from @pod", "New edition of @pod", "A new Macro Voices interview"
  /^(?:a )?new .+ discussion/i,
  /^(?:a )?new discussion/i,
  /^(?:another )?new .+ edition/i,
  /^(?:a )?new .+ interview/i,
  /\bedition of @/i,
  // "Recent interview with X from Y just published yesterday"
  /^recent interview/i,
  // "A video version of @patfscott's article..."
  /\bvideo version\b/i,
  // Catch-all: any item that's essentially "go watch/listen to this content"
  /\b(?:aired|published|dropped)\s+\d+\s+hours?\s+ago/i,
  /\b(?:aired|published|dropped)\s+one\s+hour\s+ago/i,
];

// ============================================================================
// Types
// ============================================================================

interface SubstackPost {
  readonly title: string;
  readonly post_date: string;
  readonly body_html: string;
}

interface ParsedNewsItem {
  readonly text: string;
  readonly tweetUrl: string | undefined;
  readonly attribution: string | undefined;
}

// ============================================================================
// Data Source
// ============================================================================

export const dailyDegenNewsSource: DataSource = {
  name: "Crypto News",
  priority: 9,

  fetch: async (): Promise<BriefingSection> => {
    const post = await fetchLatestPost();

    if (!post) {
      return {
        title: "Crypto News",
        icon: "📰",
        items: [{ text: "Could not fetch The Daily Degen newsletter" }],
      };
    }

    const issueDate = new Date(post.post_date);
    const title = formatSectionTitle(issueDate);
    const items = parseNewsSection(post.body_html);

    if (items.length === 0) {
      return {
        title,
        icon: "📰",
        items: [{ text: "No news items found in latest edition" }],
      };
    }

    return {
      title,
      icon: "📰",
      items: items.map(toBriefingItem),
      summary: "Curated from The Daily Degen",
    };
  },
};

// ============================================================================
// API Client
// ============================================================================

const fetchLatestPost = async (): Promise<SubstackPost | undefined> => {
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = `daily-degen-${today}`;

  return withCache(
    cacheKey,
    async () => {
      const response = await fetch(SUBSTACK_API, {
        headers: {
          Accept: "application/json",
          "User-Agent": "MorningBriefing/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`Substack API error: ${response.status}`);
      }

      const posts = (await response.json()) as SubstackPost[];
      return posts[0];
    },
    { ttlMs: CACHE_TTL_MS },
  );
};

// ============================================================================
// HTML Parsing
// ============================================================================

/**
 * Parse the "Important News and Analysis" section from the newsletter HTML.
 *
 * Structure in the HTML:
 * - `<h3>` heading containing "Important News And Analysis"
 * - Followed by `<p>` tags starting with `-` for each news item
 * - Each `<p>` is followed by a `<div class="captioned-image-container">`
 *   containing a `<figure>` with an `<a>` linking to the tweet
 * - Section ends at the next `<h3>` (typically "Conclusion")
 */
export const parseNewsSection = (html: string): readonly ParsedNewsItem[] => {
  const $ = cheerio.load(html);

  // Find the heading
  const heading = $("h3")
    .filter((_, el) => $(el).text().includes(SECTION_HEADING))
    .first();

  if (heading.length === 0) return [];

  // Collect all sibling elements between this heading and the next h3
  const items: ParsedNewsItem[] = [];
  let current = heading.next();

  while (current.length > 0 && !current.is("h3")) {
    if (current.is("p")) {
      const rawText = current.text().trim();

      if (rawText.startsWith("-")) {
        const cleanedText = rawText.slice(1).trim();

        if (!shouldSkipItem(cleanedText)) {
          // Look for tweet URL in the next sibling (image container)
          const tweetUrl = extractTweetUrl($, current);
          const attribution = extractAttribution(cleanedText);
          const displayText = stripAttribution(cleanedText);

          items.push({
            text: displayText,
            tweetUrl,
            attribution,
          });
        }
      }
    }

    current = current.next();
  }

  return items;
};

// ============================================================================
// Filtering
// ============================================================================

/** Returns true if the item should be excluded (video/podcast/motivational). */
export const shouldSkipItem = (text: string): boolean =>
  SKIP_PATTERNS.some((pattern) => pattern.test(text));

// ============================================================================
// Text Extraction Helpers
// ============================================================================

/**
 * Extract the tweet URL from the image container following a paragraph.
 *
 * Substack renders tweet embeds as screenshots wrapped in an `<a>` tag
 * with the tweet URL as the `href`, inside a `<div class="captioned-image-container">`.
 */
const extractTweetUrl = (
  $: cheerio.CheerioAPI,
  paragraph: ReturnType<cheerio.CheerioAPI>,
): string | undefined => {
  // Walk forward through siblings to find the image container
  let sibling = paragraph.next();
  // Skip whitespace/text nodes; the image container may not be immediately next
  for (let i = 0; i < 3 && sibling.length > 0; i++) {
    if (sibling.hasClass("captioned-image-container")) {
      const link = sibling.find("a.image-link").first();
      const href = link.attr("href");
      if (href && isTwitterUrl(href)) {
        return href;
      }
    }
    // Also check for tweet-style links in the paragraph itself
    if (sibling.is("p") || sibling.is("h3")) break;
    sibling = sibling.next();
  }

  return undefined;
};

const isTwitterUrl = (url: string): boolean =>
  url.startsWith("https://x.com/") || url.startsWith("https://twitter.com/");

/**
 * Extract attribution from the item text.
 * Patterns: "h/t @handle", "via @handle", "from @handle"
 */
export const extractAttribution = (text: string): string | undefined => {
  // Match "h/t @handle" or "h/t something from @handle"
  const htMatch = text.match(/,?\s*h\/t\s+(.+?)(?::?\s*$)/i);
  if (htMatch?.[1]) return `h/t ${htMatch[1].replace(/:$/, "").trim()}`;

  // Match "via @handle"
  const viaMatch = text.match(/,?\s*via\s+(@\w+(?:\s+and\s+@\w+)*)/i);
  if (viaMatch?.[1]) return `via ${viaMatch[1]}`;

  return undefined;
};

/**
 * Strip the attribution suffix from the display text.
 * "Some news, h/t @handle:" -> "Some news"
 */
export const stripAttribution = (text: string): string => {
  return text
    .replace(/,?\s*h\/t\s+.+?(?::?\s*$)/i, "")
    .replace(/,?\s*via\s+@\w+(?:\s+and\s+@\w+)*(?::?\s*$)/i, "")
    .replace(/:\s*$/, "")
    .trim();
};

// ============================================================================
// Formatting
// ============================================================================

const toBriefingItem = (item: ParsedNewsItem): BriefingItem => ({
  text: item.text,
  url: item.tweetUrl,
  detail: item.attribution,
  paddingAfter: true,
});

/**
 * Format the section title with the newsletter issue date.
 * e.g., "Crypto News, Feb 14th"
 */
export const formatSectionTitle = (date: Date): string => {
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = date.getUTCDate();
  const suffix = getOrdinalSuffix(day);
  return `Crypto News, ${month} ${day}${suffix}`;
};

/** Return the ordinal suffix for a number (st, nd, rd, th). */
export const getOrdinalSuffix = (n: number): string => {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";

  switch (n % 10) {
    case 1: {
      return "st";
    }
    case 2: {
      return "nd";
    }
    case 3: {
      return "rd";
    }
    default: {
      return "th";
    }
  }
};

// ============================================================================
// Mock Data for Testing
// ============================================================================

export const mockDailyDegenNewsSource: DataSource = {
  name: "Crypto News",
  priority: 9,

  fetch: async (): Promise<BriefingSection> => ({
    title: "Crypto News, Feb 14th",
    icon: "📰",
    items: [
      {
        text: "Total crypto market cap still 45% below ATH's; stocks only ~5% below",
        detail: "h/t @DaanCrypto",
        url: "https://x.com/DaanCrypto/status/2022709054737350680",
      },
      {
        text: "New Aave proposal sparks contentious community debate",
        detail: "via @0xLouisT and @Marczeller",
        url: "https://x.com/0xLouisT/status/2022292100016955468",
      },
      {
        text: "Netherlands: 36% tax on unrealized gains draws continued criticism",
        detail: "h/t @resdegen",
        url: "https://x.com/resdegen/status/2022343354135310484",
      },
      {
        text: "Figure discloses significant data breach",
        detail: "h/t @CoinBureau",
        url: "https://x.com/coinbureau/status/2022669974905524252",
      },
    ],
    summary: "Curated from The Daily Degen",
  }),
};
