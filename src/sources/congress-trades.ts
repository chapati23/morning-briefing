/**
 * Congress Trades Data Source
 *
 * Scrapes US Congress member stock trades from capitoltrades.com
 * and surfaces significant trades using heuristic scoring.
 */

import * as cheerio from "cheerio";
import { backOff } from "exponential-backoff";
import type { BriefingSection, DataSource } from "../types";
import { withCache } from "../utils";
import committeeSectors from "../data/committee-sectors.json";
import excludedTickers from "../data/excluded-tickers.json";
// Last reviewed: 2026-02-25
import politicianTiers from "../data/congress-politicians.json";
// TODO: ticker-sectors currently maps each ticker to a single sector string.
// Some tickers span multiple sectors (e.g., NVDA → "tech" + "defense").
// Future improvement: support string[] per ticker for multi-sector matching.
import tickerSectors from "../data/ticker-sectors.json";

const CAPITOL_TRADES_URL = "https://www.capitoltrades.com/trades";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ============================================================================
// Types
// ============================================================================

export interface CongressTrade {
  readonly politician: string;
  readonly party: "D" | "R" | "I";
  readonly chamber: "House" | "Senate";
  readonly state: string;
  readonly company: string;
  readonly ticker: string;
  readonly tradeDate: Date;
  readonly disclosureDate: Date;
  readonly filingLagDays: number;
  readonly owner: string;
  readonly type: "buy" | "sell";
  readonly rawType: string;
  readonly amountRange: string;
  readonly amountLower: number;
  readonly price: string;
  readonly score: number;
  readonly hot: boolean;
  readonly url: string;
  readonly committeeRelevance: {
    committee: string;
    tier: "direct" | "tangential";
  } | null;
}

// ============================================================================
// Amount Parsing
// ============================================================================

/**
 * Parse Capitol Trades amount range strings into a numeric lower bound.
 *
 * Known formats: "1K–15K", "15K–50K", "50K–100K", "100K–250K",
 * "250K–500K", "500K–1M", "1M–5M", "5M–25M", "25M–50M"
 */
export const parseAmountRange = (range: string): number => {
  const cleaned = range.replace(/[$,\s]/g, "");
  // Extract the lower bound (before the dash/en-dash)
  const lowerStr = cleaned.split(/[–-]/)[0]?.trim();
  if (!lowerStr) return 0;
  return parseAmountValue(lowerStr);
};

export const parseAmountValue = (value: string): number => {
  const cleaned = value.replace(/[$,\s]/g, "").toUpperCase();
  if (cleaned.endsWith("M")) {
    return Number.parseFloat(cleaned.replace("M", "")) * 1_000_000;
  }
  if (cleaned.endsWith("K")) {
    return Number.parseFloat(cleaned.replace("K", "")) * 1_000;
  }
  const num = Number.parseFloat(cleaned);
  return Number.isNaN(num) ? 0 : num;
};

/**
 * Format an amount range for display: "100K–250K" → "$100K – $250K"
 */
const formatAmountDisplay = (range: string): string => {
  // Just pass through the raw range with $ prefix
  return `$${range.replace(/–/g, " – $")}`;
};

// ============================================================================
// Scoring
// ============================================================================

const getBaseAmountScore = (amountLower: number): number => {
  if (amountLower >= 1_000_000) return 5;
  if (amountLower >= 500_000) return 3;
  if (amountLower >= 250_000) return 2;
  if (amountLower >= 100_000) return 1;
  return 0;
};

interface PoliticianEntry {
  multiplier: number;
  role?: string;
  committees?: string[];
  chamber?: string;
  state?: string;
  party?: string;
}

const getPoliticianEntry = (name: string): PoliticianEntry | undefined => {
  const entry = (politicianTiers as Record<string, unknown>)[name];
  if (entry && typeof entry === "object" && "multiplier" in entry) {
    return entry as PoliticianEntry;
  }
  return undefined;
};

const getPoliticianMultiplier = (name: string): number => {
  return getPoliticianEntry(name)?.multiplier ?? 1;
};

/**
 * Direction weighting for trade types.
 *
 * Capitol Trades does not reliably distinguish full vs partial sales in the
 * HTML table. The "type" column shows "sell" or "buy" (sometimes "exchange").
 * If we detect "sale_full" or "sale_partial" in future data, those weights
 * apply. For now, most sales map to the generic 1.5x sell weight.
 */
const getDirectionWeight = (type: "buy" | "sell", rawType?: string): number => {
  const raw = rawType?.toLowerCase().trim() ?? "";
  if (raw === "sale_full") return 1.75;
  if (raw === "sale_partial") return 1.25;
  if (raw === "exchange") return 0.75;
  return type === "sell" ? 1.5 : 1;
};

interface CommitteeSectorEntry {
  direct: string[];
  tangential: string[];
}

/**
 * Check if a politician's committee assignments overlap with the sector
 * of the traded ticker. Returns an object with the matching committee name
 * and relevance tier, or null if no match.
 *
 * NOTE: Uses first-match semantics — iterates committees in order and returns
 * the first overlap found. A politician on multiple relevant committees will
 * only surface the first match.
 */
export const getCommitteeRelevance = (
  politician: string,
  ticker: string,
): { committee: string; tier: "direct" | "tangential" } | null => {
  const entry = getPoliticianEntry(politician);
  if (!entry?.committees?.length) return null;

  const tickerSector = (tickerSectors as Record<string, string>)[ticker];
  if (!tickerSector) {
    console.debug(`[congress-trades] No sector mapping for ticker: ${ticker}`);
    return null;
  }

  for (const committee of entry.committees) {
    const sectors = (
      committeeSectors as Record<string, CommitteeSectorEntry | string>
    )[committee] as CommitteeSectorEntry | undefined;
    if (!sectors || typeof sectors === "string") continue;
    if (sectors.direct.includes(tickerSector)) {
      return { committee, tier: "direct" };
    }
    if (sectors.tangential.includes(tickerSector)) {
      return { committee, tier: "tangential" };
    }
  }
  return null;
};

const getFreshnessModifier = (filingLagDays: number): number => {
  if (filingLagDays <= 7) return 1.5;
  if (filingLagDays > 30) return 0.5;
  return 1;
};

export const calculateScore = (trade: {
  amountLower: number;
  politician: string;
  type: "buy" | "sell";
  rawType?: string;
  filingLagDays: number;
  ticker?: string;
  /** Pre-computed committee relevance to avoid redundant calculation. */
  committeeRelevance?: {
    committee: string;
    tier: "direct" | "tangential";
  } | null;
}): number => {
  const base = getBaseAmountScore(trade.amountLower);
  if (base === 0) return 0;

  // Use pre-computed relevance if provided, otherwise compute on the fly
  const relevance =
    trade.committeeRelevance === undefined
      ? trade.ticker
        ? getCommitteeRelevance(trade.politician, trade.ticker)
        : null
      : trade.committeeRelevance;

  // Direct oversight → 2x, tangential → 1.5x, no match → 1x
  let committeeMultiplier = 1;
  if (relevance) {
    committeeMultiplier = relevance.tier === "direct" ? 2 : 1.5;
    console.debug(
      `[congress-trades] Sector relevance: ${trade.politician} (${relevance.committee}) traded ${trade.ticker} → ${committeeMultiplier}x boost`,
    );
  }

  return (
    base *
    getPoliticianMultiplier(trade.politician) *
    getDirectionWeight(trade.type, trade.rawType) *
    getFreshnessModifier(trade.filingLagDays) *
    committeeMultiplier
  );
};

// ============================================================================
// HTML Parsing
// ============================================================================

const parseParty = (text: string): "D" | "R" | "I" => {
  if (text.includes("Democrat")) return "D";
  if (text.includes("Republican")) return "R";
  return "I";
};

const parseChamber = (text: string): "House" | "Senate" => {
  return text.includes("Senate") ? "Senate" : "House";
};

const parseTradeDate = (dateStr: string): Date | null => {
  // Format: "10 Feb2026" → need to split properly
  const match = dateStr.match(/(\d{1,2})\s*(\w{3})\s*(\d{4})/);
  if (!match?.[1] || !match[2] || !match[3]) {
    console.warn(
      `[congress-trades] ⚠️ Could not parse trade date: "${dateStr}"`,
    );
    return null;
  }
  const parsed = new Date(`${match[2]} ${match[1]}, ${match[3]}`);
  if (Number.isNaN(parsed.getTime())) {
    console.warn(`[congress-trades] ⚠️ Invalid trade date: "${dateStr}"`);
    return null;
  }
  return parsed;
};

export const parseDisclosureDate = (
  text: string,
  now: Date = new Date(),
): Date => {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === "today") {
    return new Date(now);
  }

  if (trimmed === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

  const daysAgoMatch = trimmed.match(/^(\d+)\s*days?\s*(ago)?$/);
  if (daysAgoMatch?.[1]) {
    const d = new Date(now);
    d.setDate(d.getDate() - Number.parseInt(daysAgoMatch[1], 10));
    return d;
  }

  const parsed = new Date(text.trim());
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return new Date(now);
};

const parseFilingLag = (text: string): number => {
  const match = text.match(/(\d+)/);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
};

const parseTradeType = (text: string): "buy" | "sell" => {
  const lower = text.toLowerCase().trim();
  if (lower.includes("buy") || lower === "purchase") return "buy";
  if (
    lower.includes("sell") ||
    lower === "sale" ||
    lower === "exchange" ||
    lower === "sale_full" ||
    lower === "sale_partial"
  )
    return "sell";
  console.warn(
    `[congress-trades] ⚠️ Unknown trade type: "${text}", defaulting to "sell"`,
  );
  return "sell";
};

const cleanTicker = (ticker: string): string => {
  // "HSY:US" → "HSY"
  return ticker.split(":")[0]?.trim() ?? ticker;
};

export const parseCapitolTradesHTML = (html: string): CongressTrade[] => {
  const $ = cheerio.load(html);
  const trades: CongressTrade[] = [];

  // Validate expected table structure
  const table = $("table");
  if (table.length === 0) {
    if (html.length > 1000) {
      console.warn(
        `[congress-trades] ⚠️ Expected table structure not found — Capitol Trades may have changed layout`,
      );
    }
    return trades;
  }

  let skipped = 0;

  $("table tr")
    .slice(1)
    .each((_, row) => {
      try {
        const cells = $(row).find("td");
        if (cells.length < 9) {
          skipped++;
          return;
        }

        const politicianCell = $(cells[0]);
        const issuerCell = $(cells[1]);

        const politician =
          politicianCell.find(".politician-name").text().trim() ||
          politicianCell.find("a[href*=politicians]").text().trim();
        if (!politician) {
          skipped++;
          return;
        }

        const partyText = politicianCell.find(".q-field.party").text().trim();
        const chamberText = politicianCell
          .find(".q-field.chamber")
          .text()
          .trim();
        const state = politicianCell.find("[class*=us-state]").text().trim();

        const company = issuerCell.find(".issuer-name a").text().trim();
        const rawTicker = issuerCell.find(".issuer-ticker").text().trim();
        const ticker = cleanTicker(rawTicker);

        const disclosureDateText = $(cells[2]).text().trim();
        const tradeDateText = $(cells[3]).text().trim();
        const filingLagText = $(cells[4]).text().trim();
        const owner = $(cells[5]).text().trim();
        const typeText = $(cells[6]).text().trim();
        const amountRange = $(cells[7]).text().trim();
        const price = $(cells[8]).text().trim();

        // Extract trade detail URL from the row link
        // NOTE: a[href*='/trades/'] is fragile — will break if Capitol Trades
        // changes their URL structure. Monitor for 404s in scraped URLs.
        const rowLink =
          $(row).find("a[href*='/trades/']").attr("href") ??
          politicianCell.find("a[href*='/trades/']").attr("href") ??
          "";
        const url = rowLink
          ? rowLink.startsWith("http")
            ? rowLink
            : `https://www.capitoltrades.com${rowLink}`
          : "";

        const tradeDate = parseTradeDate(tradeDateText);
        if (!tradeDate) {
          skipped++;
          return;
        }
        const filingLagDays = parseFilingLag(filingLagText);
        const type = parseTradeType(typeText);
        const amountLower = parseAmountRange(amountRange);
        const committeeRelevance = getCommitteeRelevance(politician, ticker);

        // Pass pre-computed relevance to avoid redundant calculation
        const score = calculateScore({
          amountLower,
          politician,
          type,
          rawType: typeText,
          filingLagDays,
          ticker,
          committeeRelevance,
        });

        trades.push({
          politician,
          party: parseParty(partyText),
          chamber: parseChamber(chamberText),
          state,
          company,
          ticker,
          tradeDate,
          disclosureDate: parseDisclosureDate(disclosureDateText),
          filingLagDays,
          owner,
          type,
          rawType: typeText,
          amountRange,
          amountLower,
          price,
          score,
          hot: score >= 6,
          url,
          committeeRelevance,
        });
      } catch {
        skipped++;
      }
    });

  if (skipped > 0) {
    console.log(
      `[congress-trades] Parsed ${trades.length} trades, skipped ${skipped} rows (parse errors)`,
    );
  }

  // Zero-trade canary: non-empty HTML but no trades parsed
  if (trades.length === 0 && html.length > 1000) {
    console.warn(
      `[congress-trades] ⚠️ Parsed 0 trades from ${html.length} bytes HTML — possible parser breakage`,
    );
  }

  return trades;
};

// ============================================================================
// Filtering
// ============================================================================

const excludedTickerSet = new Set(excludedTickers);

export const filterTrades = (trades: CongressTrade[]): CongressTrade[] => {
  return trades
    .filter((t) => t.ticker && t.ticker !== "N/A")
    .filter((t) => !excludedTickerSet.has(t.ticker))
    .filter((t) => t.amountLower >= 100_000)
    .filter((t) => t.score >= 3)
    .sort((a, b) => b.score - a.score);
};

// ============================================================================
// Formatting
// ============================================================================

const formatDate = (date: Date): string => {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatPartyState = (trade: CongressTrade): string => {
  return `${trade.party}-${trade.state}`;
};

const formatChamber = (chamber: "House" | "Senate"): string => {
  return chamber === "Senate" ? "Sen." : "Rep.";
};

export const formatTradeItem = (
  trade: CongressTrade,
): { text: string; detail: string; url: string } => {
  const prefix = trade.hot ? "🔥 " : "";
  const action = trade.type === "buy" ? "purchased" : "sold";
  const text = `${prefix}${formatChamber(trade.chamber)} ${trade.politician} (${formatPartyState(trade)}) ${action} ${trade.ticker}`;
  const committeeLine = trade.committeeRelevance
    ? `${trade.committeeRelevance.committee} · `
    : "";
  const detail = `${committeeLine}${formatAmountDisplay(trade.amountRange)} · traded ${formatDate(trade.tradeDate)} · filed ${formatDate(trade.disclosureDate)}`;
  return { text, detail, url: trade.url };
};

// ============================================================================
// Deduplication
// ============================================================================

interface GroupedTrade {
  readonly politician: string;
  readonly party: "D" | "R" | "I";
  readonly chamber: "House" | "Senate";
  readonly state: string;
  readonly ticker: string;
  readonly type: "buy" | "sell";
  readonly count: number;
  readonly totalAmountLower: number;
  readonly maxScore: number;
  readonly hot: boolean;
  readonly trades: CongressTrade[];
  readonly url: string;
  readonly committeeRelevance: {
    committee: string;
    tier: "direct" | "tangential";
  } | null;
}

export const deduplicateTrades = (
  trades: CongressTrade[],
): (CongressTrade | GroupedTrade)[] => {
  const groups = new Map<string, CongressTrade[]>();

  for (const trade of trades) {
    const key = `${trade.politician}|${trade.ticker}|${trade.type}`;
    const group = groups.get(key);
    if (group) {
      group.push(trade);
    } else {
      groups.set(key, [trade]);
    }
  }

  const result: (CongressTrade | GroupedTrade)[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const single = group.at(0);
      if (single) result.push(single);
    } else {
      const first = group.at(0);
      if (!first) continue;
      const totalAmountLower = group.reduce((sum, t) => sum + t.amountLower, 0);
      const maxScore = Math.max(...group.map((t) => t.score));
      const relevantTrade = group.find((t) => t.committeeRelevance);
      result.push({
        politician: first.politician,
        party: first.party,
        chamber: first.chamber,
        state: first.state,
        ticker: first.ticker,
        type: first.type,
        count: group.length,
        totalAmountLower,
        maxScore,
        hot: maxScore >= 6,
        trades: group,
        url: first.url,
        committeeRelevance: relevantTrade?.committeeRelevance ?? null,
      });
    }
  }

  return result.sort((a, b) => {
    const scoreA = "maxScore" in a ? a.maxScore : a.score;
    const scoreB = "maxScore" in b ? b.maxScore : b.score;
    return scoreB - scoreA;
  });
};

const formatGroupedAmount = (trades: CongressTrade[]): string => {
  const amounts = trades.map((t) => t.amountLower).sort((a, b) => a - b);
  const low = amounts.at(0);
  const high = amounts.at(-1);
  if (low === undefined || high === undefined)
    return formatAmountDisplay(trades[0]?.amountRange ?? "");
  if (low === high) return formatAmountDisplay(trades.at(0)?.amountRange ?? "");
  return `$${formatCompactAmount(low)}–$${formatCompactAmount(high)} total`;
};

const formatCompactAmount = (amount: number): string => {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(0)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return String(amount);
};

export const formatDeduplicatedItem = (
  entry: CongressTrade | GroupedTrade,
): { text: string; detail: string; url: string } => {
  if (!("count" in entry)) return formatTradeItem(entry);

  const prefix = entry.hot ? "🔥 " : "";
  const chamber = entry.chamber === "Senate" ? "Sen." : "Rep.";
  const action = entry.type === "buy" ? "purchased" : "sold";
  const text = `${prefix}${chamber} ${entry.politician} (${entry.party}-${entry.state}) ${action} ${entry.ticker} (${entry.count} trades, ${formatGroupedAmount(entry.trades)})`;
  const committeeLine = entry.committeeRelevance
    ? `${entry.committeeRelevance.committee} · `
    : "";
  const detail = `${committeeLine}Combined from ${entry.count} transactions`;
  return { text, detail, url: entry.url };
};

// ============================================================================
// Data Source
// ============================================================================

const fetchCapitolTradesHTML = async (): Promise<string> => {
  const response = await backOff(
    () =>
      fetch(CAPITOL_TRADES_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(30_000),
      }),
    {
      numOfAttempts: 3,
      startingDelay: 1000,
      timeMultiple: 2,
      jitter: "full",
      retry: (error: unknown, attemptNumber) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[congress-trades] Attempt ${attemptNumber} failed: ${message}. Retrying...`,
        );
        return true;
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Capitol Trades returned ${response.status}`);
  }

  return response.text();
};

export const congressTradesSource: DataSource = {
  name: "Congress Trades",
  priority: 6,
  timeoutMs: 30_000,

  fetch: async (date: Date): Promise<BriefingSection> => {
    const dateKey = date.toISOString().split("T")[0];
    const cacheKey = `congress-trades-${dateKey}`;

    try {
      const html = await withCache(cacheKey, fetchCapitolTradesHTML, {
        ttlMs: CACHE_TTL_MS,
      });

      const allTrades = parseCapitolTradesHTML(html);
      console.log(
        `[congress-trades] Parsed ${allTrades.length} trades, filtering...`,
      );

      const filtered = filterTrades(allTrades);
      console.log(`[congress-trades] ${filtered.length} trades passed filters`);

      if (filtered.length === 0 && allTrades.length > 0) {
        return {
          title: "Congress Trades",
          icon: "🏛",
          items: [
            {
              text: "No significant trades in the last 24h",
              detail: `${allTrades.length} trades checked, none passed filters`,
            },
          ],
        };
      }

      const deduplicated = deduplicateTrades(filtered);

      return {
        title: "Congress Trades",
        icon: "🏛",
        items: deduplicated.map((entry) => {
          const { text, detail, url } = formatDeduplicatedItem(entry);
          return { text, detail, ...(url ? { url } : {}) };
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[congress-trades] Failed to fetch: ${message}`);
      return {
        title: "Congress Trades",
        icon: "🏛",
        items: [],
      };
    }
  },
};

// ============================================================================
// Mock Data for Testing
// ============================================================================

export const mockCongressTradesSource: DataSource = {
  name: "Congress Trades",
  priority: 6,

  fetch: async (): Promise<BriefingSection> => ({
    title: "Congress Trades",
    icon: "🏛",
    items: [
      {
        text: "🔥 Rep. Nancy Pelosi (D-CA) purchased NVDA",
        detail: "$1M – $5M · traded Jan 15 · filed Feb 20",
      },
      {
        text: "Sen. Tommy Tuberville (R-AL) sold RTX",
        detail: "$250K – $500K · traded Feb 1 · filed Feb 18",
      },
    ],
  }),
};
