/**
 * Polymarket Data Source
 *
 * Fetches prediction market data from Polymarket's Gamma API.
 * Surfaces market-moving events with trading implications.
 */

import {
  getImplicationsForMarket,
  isExcludedCategory,
  isShortTermPriceBet,
  isSportsTitle,
  type MarketImplication,
} from "../config/polymarket-correlations";
import type { BriefingItem, BriefingSection, DataSource } from "../types";

const POLYMARKET_API = "https://gamma-api.polymarket.com";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Minimum liquidity to consider a market significant ($)
  minLiquidity: 100_000,

  // Thresholds for "mover" classification (as decimals - API returns 0.10 for 10%)
  significantDayChange: 0.1, // 10% probability change in 24h
  significantHourChange: 0.05, // 5% probability change in 1h

  // Output limits
  maxMovers: 5,
  maxTopMarkets: 5,

  // API fetch limit
  fetchLimit: 200,
} as const;

// ============================================================================
// Types
// ============================================================================

export interface TopOutcome {
  readonly name: string;
  readonly probability: number;
  readonly change: number; // 24h change as decimal (0.10 = 10%)
}

interface ParsedMarket {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly probability: number;
  readonly oneDayPriceChange: number;
  readonly oneHourPriceChange: number;
  readonly oneWeekPriceChange: number;
  readonly volume: number;
  readonly volume24hr: number;
  readonly liquidity: number;
  readonly endDate: Date;
  readonly category: string;
  readonly url: string;
  readonly isMultiMarket: boolean;
  readonly topOutcomes?: readonly TopOutcome[];
}

interface ClassifiedMarket extends ParsedMarket {
  readonly isMover: boolean;
  readonly implications: readonly MarketImplication[];
}

// ============================================================================
// Data Sources
// ============================================================================

/**
 * Shared helper to fetch and classify markets.
 * Cached within a single briefing run to avoid duplicate API calls.
 */
let cachedClassified: ClassifiedMarket[] | null = null;

const getClassifiedMarkets = async (): Promise<ClassifiedMarket[]> => {
  if (cachedClassified) return cachedClassified;

  const markets = await fetchAndParseMarkets();

  cachedClassified = markets
    .filter((m) => m.liquidity >= CONFIG.minLiquidity)
    .filter((m) => !isExcludedCategory(m.category))
    .filter((m) => !isSportsTitle(m.title))
    .filter((m) => !isShortTermPriceBet(m.title))
    .map(classifyMarket);

  return cachedClassified;
};

/**
 * Polymarket Movers - Markets with significant 24h price changes.
 */
export const polymarketMoversSource: DataSource = {
  name: "Polymarket Movers",
  priority: 5,

  fetch: async (): Promise<BriefingSection> => {
    const classified = await getClassifiedMarkets();

    const movers = classified
      .filter((m) => m.isMover)
      .sort(
        (a, b) => Math.abs(b.oneDayPriceChange) - Math.abs(a.oneDayPriceChange),
      )
      .slice(0, CONFIG.maxMovers);

    if (movers.length === 0) {
      return {
        title: "Polymarket Movers",
        icon: "📈",
        items: [{ text: "No significant moves overnight" }],
      };
    }

    return {
      title: "Polymarket Movers",
      icon: "📈",
      items: movers.map(formatMoverItem),
      summary: `${movers.length} market${movers.length > 1 ? "s" : ""} moved significantly`,
    };
  },
};

/**
 * Polymarket Top Markets - High-volume markets to monitor.
 */
export const polymarketTopMarketsSource: DataSource = {
  name: "Polymarket Top Markets",
  priority: 6, // After movers

  fetch: async (): Promise<BriefingSection> => {
    const classified = await getClassifiedMarkets();

    const topMarkets = classified
      .filter((m) => !m.isMover)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, CONFIG.maxTopMarkets);

    if (topMarkets.length === 0) {
      return {
        title: "Polymarket Top Markets",
        icon: "🎯",
        items: [{ text: "No top markets to show" }],
      };
    }

    return {
      title: "Polymarket Top Markets",
      icon: "🎯",
      items: topMarkets.map(formatTopMarketItem),
    };
  },
};

// ============================================================================
// API Client
// ============================================================================

interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  category: string;
  volume: number;
  liquidity: number;
  markets: GammaMarket[];
}

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  outcomePrices: string;
  volume: string;
  volumeNum: number;
  volume24hr: number;
  liquidity: string;
  liquidityNum: number;
  endDate: string;
  category: string;
  oneDayPriceChange: number;
  oneHourPriceChange: number;
  oneWeekPriceChange: number;
  lastTradePrice: number;
}

const fetchAndParseMarkets = async (): Promise<ParsedMarket[]> => {
  const url = new URL(`${POLYMARKET_API}/events`);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", CONFIG.fetchLimit.toString());
  url.searchParams.set("order", "volume");
  url.searchParams.set("ascending", "false");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "MorningBriefing/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Polymarket API error: ${response.status}`);
  }

  const events = (await response.json()) as GammaEvent[];

  // Flatten events to markets, taking the primary market from each event
  const markets: ParsedMarket[] = [];

  for (const event of events) {
    // Get the primary market (first one, or the one with highest volume)
    const primaryMarket = event.markets[0];
    if (!primaryMarket) continue;

    const parsed = parseMarket(event, primaryMarket);
    if (parsed) {
      markets.push(parsed);
    }
  }

  return markets;
};

/**
 * Extract a short name from a market question.
 * "Will Gavin Newsom win the 2028..." -> "Newsom"
 * "Will Trump nominate Kevin Warsh..." -> "Warsh"
 * "US strikes Iran by February 5, 2026?" -> "Feb 5"
 */
export const extractOutcomeName = (question: string): string => {
  // Pattern 1: Duration ranges "1-2 weeks", "3 to 4 days", "1 week or less"
  // These appear in shutdown, strike, and other time-based markets
  const durationPatterns = [
    // "1-2 weeks", "3-4 days", "5-6 months"
    /(\d+\s*-\s*\d+\s*(?:weeks?|days?|months?|hours?))/i,
    // "1 to 2 weeks", "3 to 4 days"
    /(\d+\s+to\s+\d+\s+(?:weeks?|days?|months?|hours?))/i,
    // "less than 1 week", "under 2 weeks"
    /((?:less than|under|fewer than)\s+\d+\s*(?:weeks?|days?|months?|hours?))/i,
    // "more than 4 weeks", "over 3 months", "4+ weeks"
    /((?:more than|over|greater than)\s+\d+\s*(?:weeks?|days?|months?|hours?))/i,
    /(\d+\+\s*(?:weeks?|days?|months?|hours?))/i,
    // "1 week or less", "2 days or more"
    /(\d+\s*(?:weeks?|days?|months?|hours?)\s+or\s+(?:less|more|fewer))/i,
    // Standalone duration at end: "...last 1 week", "...within 3 days"
    /(?:last|within|for)\s+(\d+\s*(?:weeks?|days?|months?|hours?))/i,
  ];

  for (const pattern of durationPatterns) {
    const match = question.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  // Pattern 2: Date-based questions "...by [Month] [Day]..."
  const dateMatch = question.match(
    /by\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i,
  );
  if (dateMatch?.[1] && dateMatch[2]) {
    const month = dateMatch[1].slice(0, 3); // "February" -> "Feb"
    return `${month} ${dateMatch[2]}`;
  }

  // Pattern 3: Person names "Will [Name] win/be/become..."
  const namePatterns = [
    /^Will\s+(.+?)\s+win\b/i,
    /^Will\s+(.+?)\s+be\b/i,
    /^Will\s+(.+?)\s+become\b/i,
    /nominate\s+(.+?)\s+as\b/i,
  ];

  for (const pattern of namePatterns) {
    const match = question.match(pattern);
    if (match?.[1]) {
      const fullName = match[1].trim();
      // Skip if it looks like a date phrase
      if (/^(the|a|an|us|uk)\b/i.test(fullName)) continue;

      // Return last word (usually last name) for brevity
      const parts = fullName.split(" ").filter((p) => p.length > 0);
      const lastName = parts.at(-1);
      if (lastName) {
        // Remove common suffixes and clean up
        return lastName.replace(/[?.,!]$/, "").replace(/^['"]|['"]$/g, "");
      }
    }
  }

  // Pattern 4: Year-based "...in [Year]?"
  const yearMatch = question.match(/in\s+(202\d)/);
  if (yearMatch?.[1]) {
    return yearMatch[1];
  }

  // Fallback: extract meaningful part with more generous limit
  const cleaned = question
    .replace(/^Will\s+/i, "")
    .replace(/\?$/, "")
    .trim();
  const words = cleaned.split(" ").slice(0, 4);
  return words.join(" ").slice(0, 30);
};

/**
 * Extract top outcomes from a multi-market event.
 */
const extractTopOutcomes = (markets: GammaMarket[]): TopOutcome[] => {
  const sorted = markets
    .map((m) => ({
      name: extractOutcomeName(m.question),
      probability: m.lastTradePrice * 100,
      change: m.oneDayPriceChange,
    }))
    // Filter out completely dead (0%) and fully resolved (100%) outcomes
    .filter((o) => o.probability > 0.5 && o.probability < 99.5)
    .sort((a, b) => b.probability - a.probability);

  if (sorted.length === 0) return [];

  // Return top 2 outcomes
  return sorted.slice(0, 2);
};

const parseMarket = (
  event: GammaEvent,
  market: GammaMarket,
): ParsedMarket | null => {
  try {
    // Parse probability from outcome prices
    let probability = 50;
    try {
      const prices = JSON.parse(market.outcomePrices) as string[];
      probability = Number.parseFloat(prices[0] ?? "0.5") * 100;
    } catch {
      // Use lastTradePrice as fallback
      if (market.lastTradePrice) {
        probability = market.lastTradePrice * 100;
      }
    }

    // Use event-level liquidity as it's more reliable for multi-market events
    const eventLiquidity = event.liquidity;
    const marketLiquidity =
      market.liquidityNum || Number.parseFloat(market.liquidity) || 0;

    // Detect multi-market events (e.g., elections with multiple candidates)
    const isMultiMarket = event.markets.length > 1;
    const topOutcomes = isMultiMarket
      ? extractTopOutcomes(event.markets)
      : undefined;

    // For multi-market events, use the leader's probability as the display probability
    const displayProbability =
      isMultiMarket && topOutcomes && topOutcomes[0]
        ? topOutcomes[0].probability
        : probability;

    return {
      id: market.id,
      // Use event title for display since URL points to event page
      // (events can have multiple markets, e.g., one per candidate)
      title: event.title || market.question,
      slug: event.slug,
      probability: displayProbability,
      oneDayPriceChange: market.oneDayPriceChange,
      oneHourPriceChange: market.oneHourPriceChange,
      oneWeekPriceChange: market.oneWeekPriceChange,
      volume:
        event.volume ||
        market.volumeNum ||
        Number.parseFloat(market.volume) ||
        0,
      volume24hr: market.volume24hr,
      liquidity: Math.max(eventLiquidity, marketLiquidity), // Use higher of event or market liquidity
      endDate: new Date(market.endDate),
      category: market.category || event.category || "other",
      url: `https://polymarket.com/event/${event.slug}`,
      isMultiMarket,
      topOutcomes,
    };
  } catch {
    return null;
  }
};

// ============================================================================
// Classification
// ============================================================================

const classifyMarket = (market: ParsedMarket): ClassifiedMarket => {
  const dayChange = Math.abs(market.oneDayPriceChange);

  // For daily briefing, focus on 24h changes (not hourly)
  // This avoids showing markets with large hour change but tiny day change
  const isMover = dayChange >= CONFIG.significantDayChange;

  const implications = getImplicationsForMarket(market.title);

  return {
    ...market,
    isMover,
    implications,
  };
};

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a single outcome with its change indicator.
 */
export const formatOutcomeWithChange = (outcome: TopOutcome): string => {
  const changePct = outcome.change * 100;
  if (!Number.isFinite(changePct) || Math.abs(changePct) < 1) {
    // No significant change or invalid data
    return `${outcome.name} — ${outcome.probability.toFixed(0)}%`;
  }
  const arrow = changePct >= 0 ? "↑" : "↓";
  return `${outcome.name} — ${outcome.probability.toFixed(0)}% (${arrow}${Math.abs(changePct).toFixed(0)}%)`;
};

const formatMoverItem = (market: ClassifiedMarket): BriefingItem => {
  const vol = formatVolume(market.volume);
  let detail: string;

  if (
    market.isMultiMarket &&
    market.topOutcomes &&
    market.topOutcomes.length > 0
  ) {
    // Multi-market: ranked format with volume
    // "1. Newsom — 33% (↓3%)"
    // "2. AOC — 9% (↑2%)"
    // "$586M volume"
    const rankings = market.topOutcomes
      .map((o, i) => `${i + 1}. ${formatOutcomeWithChange(o)}`)
      .join("\n");
    detail = `${rankings}\n${vol} volume`;
  } else {
    // Binary: show probability change with volume
    const dayChangePct = market.oneDayPriceChange * 100;
    const prevProb = market.probability - dayChangePct;
    const sign = dayChangePct >= 0 ? "+" : "";
    detail = `${prevProb.toFixed(0)}% → ${market.probability.toFixed(0)}% (${sign}${dayChangePct.toFixed(0)}%) | ${vol}`;
  }

  // Add trading implications as separate line if available
  if (market.implications.length > 0) {
    const implStr = market.implications
      .slice(0, 3)
      .map((imp) => `${imp.direction === "long" ? "↑" : "↓"}${imp.asset}`)
      .join(" ");
    detail += `\n${implStr}`;
  }

  return {
    text: truncate(market.title, 70),
    url: market.url,
    sentiment: market.oneDayPriceChange >= 0 ? "positive" : "negative",
    detail,
  };
};

const formatTopMarketItem = (market: ClassifiedMarket): BriefingItem => {
  const vol = formatVolume(market.volume);
  // Convert decimal to percentage for display
  const weekChangePct = market.oneWeekPriceChange * 100;

  let detail: string;

  if (
    market.isMultiMarket &&
    market.topOutcomes &&
    market.topOutcomes.length > 0
  ) {
    // Multi-market: ranked format with volume
    // "1. Newsom — 33% (↓3%)"
    // "2. AOC — 9% (↑2%)"
    // "$586M volume"
    const rankings = market.topOutcomes
      .map((o, i) => `${i + 1}. ${formatOutcomeWithChange(o)}`)
      .join("\n");
    detail = `${rankings}\n${vol} volume`;
  } else {
    // Binary: show probability
    const prob = `${market.probability.toFixed(0)}%`;
    detail = `${prob} | ${vol}`;

    // Add weekly change if significant
    if (Math.abs(weekChangePct) >= 1) {
      const sign = weekChangePct >= 0 ? "+" : "";
      detail += ` | ${sign}${weekChangePct.toFixed(0)}% 7d`;
    }
  }

  return {
    text: truncate(market.title, 70),
    detail,
    url: market.url,
    sentiment: "neutral",
  };
};

export const formatVolume = (volume: number): string => {
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(1)}M`;
  }
  if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(0)}K`;
  }
  return `$${volume.toFixed(0)}`;
};

export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
};

// ============================================================================
// Mock Data for Testing
// ============================================================================

export const mockPolymarketMoversSource: DataSource = {
  name: "Polymarket Movers",
  priority: 5,

  fetch: async (): Promise<BriefingSection> => ({
    title: "Polymarket Movers",
    icon: "📈",
    items: [
      {
        text: "US/Israel strikes Iran by...?",
        detail:
          "1. Feb 28 — 42% (↓8%)\n2. Mar 31 — 35% (↓5%)\n$12.5M volume\n↑USO ↑XLE ↑LMT",
        sentiment: "negative",
        url: "https://polymarket.com/event/us-israel-strikes-iran",
      },
      {
        text: "Canada retaliatory tariffs by March?",
        detail: "28% → 41% (+13%) | $4.2M",
        sentiment: "positive",
        url: "https://polymarket.com/event/canada-tariffs-2026",
      },
    ],
    summary: "2 markets moved significantly",
  }),
};

export const mockPolymarketTopMarketsSource: DataSource = {
  name: "Polymarket Top Markets",
  priority: 6,

  fetch: async (): Promise<BriefingSection> => ({
    title: "Polymarket Top Markets",
    icon: "🎯",
    items: [
      {
        text: "Democratic Presidential Nominee 2028",
        detail: "1. Newsom — 33% (↓3%)\n2. AOC — 9% (↑2%)\n$586M volume",
        sentiment: "neutral",
        url: "https://polymarket.com/event/democratic-presidential-nominee-2028",
      },
      {
        text: "Presidential Election Winner 2028",
        detail: "1. Vance — 26%\n2. Newsom — 19%\n$245M volume",
        sentiment: "neutral",
        url: "https://polymarket.com/event/presidential-election-winner-2028",
      },
      {
        text: "US recession in 2026",
        detail: "28% | $8M | +5% 7d",
        sentiment: "neutral",
        url: "https://polymarket.com/event/us-recession-2026",
      },
    ],
  }),
};
