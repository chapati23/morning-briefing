/**
 * Overnight Futures Data Source
 *
 * Fetches performance of key futures contracts since the last US equity market
 * close using the Yahoo Finance chart API (free, no API key required).
 */

import type {
  BriefingItem,
  BriefingSection,
  DataSource,
  Sentiment,
} from "../types";
import { withCache } from "../utils";
import { formatTradingDate, getPreviousTradingDay } from "./etf-flows";

// ============================================================================
// Futures Configuration
// ============================================================================

interface FuturesContract {
  readonly symbol: string; // Yahoo Finance ticker
  readonly name: string; // Short display name
  readonly description: string; // What it tracks
}

const FUTURES: readonly FuturesContract[] = [
  { symbol: "ES=F", name: "ES", description: "S&P 500" },
  { symbol: "NQ=F", name: "NQ", description: "Nasdaq 100" },
  { symbol: "GC=F", name: "GC", description: "Gold" },
  { symbol: "SI=F", name: "SI", description: "Silver" },
  { symbol: "HG=F", name: "HG", description: "Copper" },
  { symbol: "CL=F", name: "CL", description: "Crude Oil" },
  { symbol: "NG=F", name: "NG", description: "Natural Gas" },
  { symbol: "ZN=F", name: "ZN", description: "10Y Treasury" },
  { symbol: "DX-Y.NYB", name: "DXY", description: "US Dollar Index" },
  { symbol: "6E=F", name: "EUR", description: "Euro FX" },
];

// ============================================================================
// Yahoo Finance Types
// ============================================================================

interface YahooChartResponse {
  readonly chart: {
    readonly result: ReadonlyArray<{
      readonly meta: {
        readonly regularMarketPrice: number;
        readonly chartPreviousClose: number;
        readonly symbol: string;
        readonly currency: string;
      };
    }> | null;
    readonly error: { readonly description: string } | null;
  };
}

interface FuturesQuote {
  readonly symbol: string;
  readonly price: number;
  readonly previousClose: number;
  readonly changePercent: number;
}

// ============================================================================
// Data Source
// ============================================================================

const YAHOO_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export const overnightFuturesSource: DataSource = {
  name: "Overnight Futures",
  priority: 3.5,

  fetch: async (date: Date): Promise<BriefingSection> => {
    console.log("[overnight-futures] Fetching futures quotes in parallel...");

    const results = await Promise.allSettled(
      FUTURES.map((contract) => fetchQuote(contract.symbol)),
    );

    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (rejected.length === results.length) {
      const errors = rejected
        .map((r) =>
          r.reason instanceof Error ? r.reason.message : String(r.reason),
        )
        .join("; ");
      throw new Error(`All futures fetches failed: ${errors}`);
    }

    const tradingDate = getPreviousTradingDay(date);
    const items = buildAlignedFuturesItems(FUTURES, results);

    return {
      title: `Overnight Futures (since ${formatTradingDate(tradingDate)} close)`,
      icon: "📈",
      items,
    };
  },
};

// ============================================================================
// Fetching
// ============================================================================

const fetchQuote = async (symbol: string): Promise<FuturesQuote> => {
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = `futures-${symbol}-${today}`;

  return withCache(cacheKey, () => fetchQuoteFromYahoo(symbol), {
    ttlMs: CACHE_TTL_MS,
  });
};

const fetchQuoteFromYahoo = async (symbol: string): Promise<FuturesQuote> => {
  const url = `${YAHOO_BASE_URL}/${encodeURIComponent(symbol)}?range=2d&interval=1d`;
  console.log(`[overnight-futures] Fetching ${symbol}...`);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status} for ${symbol}`);
  }

  const data = (await response.json()) as YahooChartResponse;

  if (data.chart.error) {
    throw new Error(
      `Yahoo Finance error for ${symbol}: ${data.chart.error.description}`,
    );
  }

  const result = data.chart.result?.[0];
  if (!result) {
    throw new Error(`No chart data returned for ${symbol}`);
  }

  const { regularMarketPrice, chartPreviousClose } = result.meta;
  if (!regularMarketPrice || !chartPreviousClose) {
    throw new Error(`Missing price data for ${symbol}`);
  }

  const changePercent =
    ((regularMarketPrice - chartPreviousClose) / chartPreviousClose) * 100;

  return {
    symbol,
    price: regularMarketPrice,
    previousClose: chartPreviousClose,
    changePercent,
  };
};

// ============================================================================
// Formatting
// ============================================================================

interface AlignmentWidths {
  readonly name: number;
  readonly price: number;
  readonly percent: number;
}

/**
 * Build all futures items with consistent column alignment.
 * Two-pass: first compute max widths, then format with padding.
 */
export const buildAlignedFuturesItems = (
  contracts: readonly FuturesContract[],
  results: readonly PromiseSettledResult<FuturesQuote>[],
): BriefingItem[] => {
  const widths = computeAlignmentWidths(contracts, results);
  return results.map((result, i) =>
    buildFuturesItem(contracts[i] as FuturesContract, result, widths),
  );
};

const computeAlignmentWidths = (
  contracts: readonly FuturesContract[],
  results: readonly PromiseSettledResult<FuturesQuote>[],
): AlignmentWidths => {
  let maxPrice = 0;
  let maxPercent = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      maxPrice = Math.max(maxPrice, formatPrice(result.value.price).length);
      maxPercent = Math.max(
        maxPercent,
        formatPercent(result.value.changePercent).length,
      );
    }
  }

  return {
    name: Math.max(...contracts.map((c) => c.name.length)),
    price: maxPrice,
    percent: maxPercent,
  };
};

export const buildFuturesItem = (
  contract: FuturesContract,
  result: PromiseSettledResult<FuturesQuote>,
  widths: AlignmentWidths,
): BriefingItem => {
  const label = `${contract.name}:`.padEnd(widths.name + 1);

  if (result.status === "fulfilled") {
    const { changePercent, price } = result.value;
    const paddedPrice = formatPrice(price).padStart(widths.price);
    const paddedPercent = formatPercent(changePercent).padStart(widths.percent);
    return {
      text: `${label} ${paddedPercent} / ${paddedPrice}`,
      sentiment: getSentiment(changePercent, contract.symbol),
      monospace: true,
    };
  }

  const error =
    result.reason instanceof Error
      ? result.reason.message
      : String(result.reason);
  console.warn(`[overnight-futures:${contract.name}] Unavailable: ${error}`);
  return {
    text: `${label} unavailable`,
    sentiment: "neutral",
    monospace: true,
  };
};

export const formatPercent = (value: number): string => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};

export const formatPrice = (value: number): string =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Per-asset "big move" thresholds (in percent). Moves above this are strong_positive/strong_negative. */
const BIG_MOVE_THRESHOLDS: Record<string, number> = {
  "ES=F": 1, // S&P 500 — 1% is a big day
  "NQ=F": 1.5, // Nasdaq — slightly more volatile
  "GC=F": 1.5, // Gold
  "SI=F": 2.5, // Silver — more volatile than gold
  "HG=F": 2, // Copper
  "CL=F": 3, // Crude Oil
  "NG=F": 5, // Natural Gas — extremely volatile
  "ZN=F": 0.5, // 10Y Treasury — very low vol
  "DX-Y.NYB": 0.5, // Dollar Index — low vol
  "6E=F": 0.7, // Euro FX
};

const FLAT_THRESHOLD = 0.05; // ±0.05% = flat

export const getSentiment = (
  changePercent: number,
  symbol?: string,
): Sentiment => {
  const absChange = Math.abs(changePercent);

  if (absChange <= FLAT_THRESHOLD) return "neutral";

  const bigThreshold =
    (symbol ? BIG_MOVE_THRESHOLDS[symbol] : undefined) ?? 1.5;

  if (changePercent > 0) {
    return absChange >= bigThreshold ? "strong_positive" : "positive";
  }
  return absChange >= bigThreshold ? "strong_negative" : "negative";
};

// ============================================================================
// Mock Data for Testing
// ============================================================================

export const mockOvernightFuturesSource: DataSource = {
  name: "Overnight Futures",
  priority: 3.5,

  fetch: async (date: Date): Promise<BriefingSection> => {
    const tradingDate = getPreviousTradingDay(date);

    return {
      title: `Overnight Futures (since ${formatTradingDate(tradingDate)} close)`,
      icon: "📈",
      items: [
        {
          text: "ES:  +0.45% /  5,432.25",
          sentiment: "positive",
          monospace: true,
        },
        {
          text: "NQ:  -0.23% / 18,765.50",
          sentiment: "negative",
          monospace: true,
        },
        {
          text: "GC:  +1.12% /  2,345.60",
          sentiment: "positive",
          monospace: true,
        },
        {
          text: "SI:  +0.87% /     28.45",
          sentiment: "positive",
          monospace: true,
        },
        {
          text: "HG:  -0.34% /      4.12",
          sentiment: "negative",
          monospace: true,
        },
        {
          text: "CL:  +0.56% /     78.23",
          sentiment: "positive",
          monospace: true,
        },
        {
          text: "NG:  -1.45% /      2.34",
          sentiment: "negative",
          monospace: true,
        },
        {
          text: "ZN:  +0.08% /    110.56",
          sentiment: "positive",
          monospace: true,
        },
        {
          text: "DXY: +0.15% /    104.32",
          sentiment: "positive",
          monospace: true,
        },
        {
          text: "EUR: -0.12% /      1.08",
          sentiment: "negative",
          monospace: true,
        },
        {
          text: "BTC: +5.23% / 98,765.00",
          sentiment: "strong_positive",
          monospace: true,
        },
      ],
    };
  },
};
