/**
 * ETF Flows Data Source
 *
 * Scrapes Bitcoin and Ethereum ETF flow data from farside.co.uk
 * Note: This site uses Cloudflare protection, so we need Puppeteer.
 */

import * as cheerio from "cheerio";
import { backOff } from "exponential-backoff";
import puppeteer from "puppeteer";
import type { BriefingSection, DataSource, ETFFlow } from "../types";
import { withCache } from "../utils";

const BTC_ETF_URL = "https://farside.co.uk/btc/";
const ETH_ETF_URL = "https://farside.co.uk/eth/";
const SOL_ETF_URL = "https://farside.co.uk/sol/";

// ============================================================================
// US Market Trading Day Calculation
// ============================================================================

/**
 * Get the previous US market trading day, accounting for weekends and holidays.
 * ETF flow data is from the previous trading day since markets report EOD.
 */
export const getPreviousTradingDay = (date: Date): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() - 1); // Start with yesterday

  // Keep going back until we find a trading day
  while (!isTradingDay(result)) {
    result.setDate(result.getDate() - 1);
  }

  return result;
};

export const isTradingDay = (date: Date): boolean => {
  const day = date.getDay();

  // Weekend check (Saturday = 6, Sunday = 0)
  if (day === 0 || day === 6) return false;

  // Holiday check
  if (isUSMarketHoliday(date)) return false;

  return true;
};

/**
 * Check if a date is a US stock market holiday.
 * Covers NYSE/NASDAQ holidays with observed day adjustments.
 */
export const isUSMarketHoliday = (date: Date): boolean => {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();
  const dayOfWeek = date.getDay();

  // New Year's Day (Jan 1, or observed on closest weekday)
  if (month === 0 && day === 1) return true;
  if (month === 0 && day === 2 && dayOfWeek === 1) return true; // Observed Monday if Jan 1 is Sunday
  if (month === 11 && day === 31 && dayOfWeek === 5) return true; // Observed Friday if Jan 1 is Saturday

  // Martin Luther King Jr. Day (3rd Monday of January)
  if (month === 0 && dayOfWeek === 1 && day >= 15 && day <= 21) return true;

  // Presidents' Day (3rd Monday of February)
  if (month === 1 && dayOfWeek === 1 && day >= 15 && day <= 21) return true;

  // Good Friday (Friday before Easter - needs calculation)
  const easterDate = getEasterDate(year);
  const goodFriday = new Date(easterDate);
  goodFriday.setDate(goodFriday.getDate() - 2);
  if (month === goodFriday.getMonth() && day === goodFriday.getDate()) {
    return true;
  }

  // Memorial Day (Last Monday of May)
  if (month === 4 && dayOfWeek === 1 && day >= 25) return true;

  // Juneteenth (June 19, or observed on closest weekday)
  if (month === 5 && day === 19) return true;
  if (month === 5 && day === 20 && dayOfWeek === 1) return true; // Observed Monday
  if (month === 5 && day === 18 && dayOfWeek === 5) return true; // Observed Friday

  // Independence Day (July 4, or observed on closest weekday)
  if (month === 6 && day === 4) return true;
  if (month === 6 && day === 5 && dayOfWeek === 1) return true; // Observed Monday
  if (month === 6 && day === 3 && dayOfWeek === 5) return true; // Observed Friday

  // Labor Day (1st Monday of September)
  if (month === 8 && dayOfWeek === 1 && day <= 7) return true;

  // Thanksgiving Day (4th Thursday of November)
  if (month === 10 && dayOfWeek === 4 && day >= 22 && day <= 28) return true;

  // Christmas Day (Dec 25, or observed on closest weekday)
  if (month === 11 && day === 25) return true;
  if (month === 11 && day === 26 && dayOfWeek === 1) return true; // Observed Monday
  if (month === 11 && day === 24 && dayOfWeek === 5) return true; // Observed Friday

  return false;
};

/**
 * Calculate Easter Sunday using the Anonymous Gregorian algorithm.
 */
export const getEasterDate = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month, day);
};

export const getFlowSentiment = (
  value: number,
): "positive" | "negative" | "neutral" => {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
};

export const formatTradingDate = (date: Date): string => {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

/**
 * Build a briefing item for an ETF, handling both success and failure cases.
 */
export const buildETFItem = (
  type: "BTC" | "ETH" | "SOL",
  result: PromiseSettledResult<ETFFlow[]>,
  url: string,
): {
  text: string;
  sentiment: "positive" | "negative" | "neutral";
  url: string;
} => {
  if (result.status === "fulfilled") {
    const total = result.value.reduce((sum, f) => sum + f.flow, 0);
    return {
      text: `${type} ETFs: ${formatMillion(total)}`,
      sentiment: getFlowSentiment(total),
      url,
    };
  }

  // Failed - show unavailable with neutral sentiment
  const error =
    result.reason instanceof Error
      ? result.reason.message
      : String(result.reason);
  console.warn(`[etf-flows:${type}] Unavailable: ${error}`);
  return {
    text: `${type} ETFs: unavailable`,
    sentiment: "neutral",
    url,
  };
};

// ============================================================================
// Data Source
// ============================================================================

export const etfFlowsSource: DataSource = {
  name: "ETF Flows",
  priority: 3,

  fetch: async (date: Date): Promise<BriefingSection> => {
    console.log(
      "[etf-flows] Starting ETF flows fetch (BTC, ETH, SOL in parallel)...",
    );

    // Use allSettled for partial success - if 1-2 fail, we still show the rest
    const results = await Promise.allSettled([
      fetchETFFlows(BTC_ETF_URL, "BTC"),
      fetchETFFlows(ETH_ETF_URL, "ETH"),
      fetchETFFlows(SOL_ETF_URL, "SOL"),
    ]);

    const [btcResult, ethResult, solResult] = results;

    // Check if ALL failed - only then throw
    const allFailed = results.every((r) => r.status === "rejected");
    if (allFailed) {
      const errors = results
        .map((r) =>
          r.status === "rejected"
            ? r.reason instanceof Error
              ? r.reason.message
              : String(r.reason)
            : "",
        )
        .filter(Boolean)
        .join("; ");
      throw new Error(`All ETF fetches failed: ${errors}`);
    }

    const tradingDate = getPreviousTradingDay(date);

    return {
      title: `ETF Flows from ${formatTradingDate(tradingDate)}`,
      icon: "📊",
      items: [
        buildETFItem("BTC", btcResult, BTC_ETF_URL),
        buildETFItem("ETH", ethResult, ETH_ETF_URL),
        buildETFItem("SOL", solResult, SOL_ETF_URL),
      ],
    };
  },
};

// ============================================================================
// Scraping
// ============================================================================

const log = (type: "BTC" | "ETH" | "SOL", message: string): void => {
  console.log(`[etf-flows:${type}] ${message}`);
};

// Cache TTL: 2 hours (data only changes once per trading day)
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Fetch ETF flows with caching (for development) and retry (for reliability).
 */
const fetchETFFlows = async (
  url: string,
  type: "BTC" | "ETH" | "SOL",
): Promise<ETFFlow[]> => {
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = `etf-flows-${type}-${today}`;

  return withCache(cacheKey, () => fetchETFFlowsWithRetry(url, type), {
    ttlMs: CACHE_TTL_MS,
  });
};

/**
 * Fetch ETF flows with retry logic for handling transient failures.
 */
const fetchETFFlowsWithRetry = async (
  url: string,
  type: "BTC" | "ETH" | "SOL",
): Promise<ETFFlow[]> => {
  return backOff(() => fetchETFFlowsFromBrowser(url, type), {
    numOfAttempts: 4, // 1 initial + 3 retries
    startingDelay: 1000,
    timeMultiple: 2,
    jitter: "full",
    retry: (error: unknown, attemptNumber) => {
      const message = error instanceof Error ? error.message : String(error);
      log(type, `Attempt ${attemptNumber} failed: ${message}. Retrying...`);
      return true;
    },
  });
};

/**
 * Core browser-based fetch logic (single attempt).
 */
const fetchETFFlowsFromBrowser = async (
  url: string,
  type: "BTC" | "ETH" | "SOL",
): Promise<ETFFlow[]> => {
  let browser;
  try {
    log(type, "Launching browser...");
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--window-size=1920,1080",
      ],
    });

    log(type, "Creating page...");
    const page = await browser.newPage();

    // Set a realistic viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Set realistic headers to avoid bot detection
    await page.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    });

    // Remove webdriver property to avoid detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });
    });

    log(type, `Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Check if we hit a Cloudflare challenge page
    const pageTitle = await page.title();
    if (pageTitle.includes("Just a moment")) {
      log(type, "Detected Cloudflare challenge, waiting for it to pass...");
      // Wait for the challenge to complete (Cloudflare usually resolves within 5-10s)
      // The function runs in browser context where document is available
      await page.waitForFunction(`!document.title.includes("Just a moment")`, {
        timeout: 15000,
      });
      // Wait for content to load after challenge
      await page.waitForNetworkIdle({ timeout: 10000 });
    }

    log(type, "Waiting for table to load...");
    await page.waitForSelector("figure table", { timeout: 30000 });

    log(type, "Parsing ETF data...");
    const html = await page.content();
    const flows = parseETFTable(html);
    log(type, `Found ${flows.length} ETF flows`);
    return flows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(type, `Error: ${message}`);
    throw error;
  } finally {
    if (browser) {
      log(type, "Closing browser...");
      await browser.close();
    }
  }
};

const parseETFTable = (html: string): ETFFlow[] => {
  const $ = cheerio.load(html);
  const flows: ETFFlow[] = [];

  // Find the ETF data table (inside <figure>, not the layout tables)
  // The farside.co.uk page has multiple tables - layout tables and the data table
  const table = $("figure table").first();
  if (table.length === 0) {
    console.error("ETF table not found in HTML");
    return flows;
  }

  // Get ETF ticker symbols from the second header row (first row has company logos, second has tickers)
  const headers: string[] = [];
  const headerRows = table.find("thead tr, tr").toArray();

  // Find the row with ticker symbols (IBIT, FBTC, etc.) - typically the second row
  for (const row of headerRows) {
    const cells = $(row).find("th, td").toArray();
    const cellTexts = cells.map((cell) => $(cell).text().trim());

    // Look for a row that contains known ticker symbols (BTC, ETH, or SOL ETFs)
    const knownTickers = new Set([
      // BTC ETFs
      "IBIT",
      "FBTC",
      "BITB",
      "ARKB",
      "BTCO",
      "EZBC",
      "BRRR",
      "HODL",
      "BTCW",
      "GBTC",
      "BTC",
      // ETH ETFs
      "ETHA",
      "FETH",
      "ETHW",
      "CETH",
      "ETHV",
      "QETH",
      "EZET",
      "ETHE",
      // SOL ETFs
      "BSOL",
      "VSOL",
      "FSOL",
      "TSOL",
      "SOEZ",
      "GSOL",
    ]);
    if (cellTexts.some((t) => knownTickers.has(t))) {
      headers.push(...cellTexts);
      break;
    }
  }

  // Fallback: use first header row if no ticker row found
  if (headers.length === 0 && headerRows.length > 0) {
    const firstRow = headerRows[0];
    if (firstRow) {
      $(firstRow)
        .find("th, td")
        .each((_, el) => {
          headers.push($(el).text().trim());
        });
    }
  }

  // Get the most recent row of data (last row with numbers)
  const rows = table.find("tbody tr, tr").toArray();

  // Find the last row with actual flow data
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row) continue;

    const cells = $(row).find("td, th").toArray();
    if (cells.length < 2) continue;

    // Check if this row has numeric data
    const firstCell = $(cells[0]).text().trim();
    if (!firstCell || firstCell.toLowerCase().includes("total")) continue;

    // Try to parse as a date row
    const dateMatch = firstCell.match(/\d{1,2}\s+\w+/);
    if (!dateMatch) continue;

    // Parse flow values (skip the Total column and any empty headers)
    for (let j = 1; j < cells.length && j < headers.length; j++) {
      const cell = cells[j];
      const header = headers[j];
      if (!cell || !header) continue;

      // Skip the Total column - we want individual ETF flows, not aggregates
      if (header.toLowerCase() === "total" || header === "") continue;

      const text = $(cell).text().trim();
      const flow = parseFlowValue(text);

      if (flow !== null && header.length > 0) {
        flows.push({
          ticker: header,
          name: header,
          flow,
          date: new Date(),
        });
      }
    }

    // Only break if we found actual ETF flows (not just the Total column)
    if (flows.length > 0) break;
  }

  return flows;
};

export const parseFlowValue = (text: string): number | null => {
  if (!text || text === "-" || text === "") return null;

  // Check if value is negative (wrapped in parentheses like "(312.2)")
  const isNegative = text.startsWith("(") && text.endsWith(")");

  // Remove parentheses, commas, and whitespace
  const cleaned = text.replace(/[(),\s]/g, "");

  // Handle values like "123.4" or "-45.6"
  const num = Number.parseFloat(cleaned);
  if (Number.isNaN(num)) return null;

  return isNegative ? -num : num;
};

// ============================================================================
// Formatting
// ============================================================================

export const formatMillion = (value: number): string => {
  if (value === 0) return "$0";
  const absValue = Math.abs(value).toFixed(1);
  if (value > 0) return `+$${absValue}M`;
  return `-$${absValue}M`;
};

// ============================================================================
// Mock Data for Testing
// ============================================================================

export const mockETFFlowsSource: DataSource = {
  name: "ETF Flows",
  priority: 3,

  fetch: async (date: Date): Promise<BriefingSection> => {
    const tradingDate = getPreviousTradingDay(date);

    return {
      title: `ETF Flows from ${formatTradingDate(tradingDate)}`,
      icon: "📊",
      items: [
        {
          text: "BTC ETFs: +$145.2M",
          sentiment: "positive",
          url: BTC_ETF_URL,
        },
        {
          text: "ETH ETFs: -$23.1M",
          sentiment: "negative",
          url: ETH_ETF_URL,
        },
        {
          text: "SOL ETFs: +$18.7M",
          sentiment: "positive",
          url: SOL_ETF_URL,
        },
      ],
    };
  },
};
