/**
 * ETF Flows Data Source
 *
 * Fetches aggregate Bitcoin, Ethereum, and Solana ETF flows from DefiLlama's
 * server-rendered ETF page. Farside remains the attribution link shown to users.
 */

import * as cheerio from "cheerio";
import { backOff } from "exponential-backoff";
import type { BriefingSection, DataSource } from "../types";
import { withCache } from "../utils";

const DEFILLAMA_ETF_URL = "https://defillama2.llamao.fi/etfs";
const BTC_ETF_URL = "https://farside.co.uk/btc/";
const ETH_ETF_URL = "https://farside.co.uk/eth/";
const SOL_ETF_URL = "https://farside.co.uk/sol/";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MIN_FLOW_TIMESTAMP = Date.UTC(2009, 0, 1) / 1000;
const MAX_FUTURE_SKEW_SECONDS = 7 * 24 * 60 * 60;

interface ETFFlowRecord {
  readonly timestamp: number;
  readonly bitcoinUsd: number;
  readonly ethereumUsd: number;
  readonly solanaUsd: number;
}

type ETFRequestError = Error & { readonly retryable: boolean };

const createETFRequestError = (
  message: string,
  retryable: boolean,
): ETFRequestError => Object.assign(new Error(message), { retryable });

// ============================================================================
// US Market Trading Day Calculation
// ============================================================================

/**
 * Get the previous US market trading day, accounting for weekends and holidays.
 * ETF flow data is from the previous trading day since markets report EOD.
 */
export const getPreviousTradingDay = (date: Date): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() - 1);

  while (!isTradingDay(result)) {
    result.setDate(result.getDate() - 1);
  }

  return result;
};

export const isTradingDay = (date: Date): boolean => {
  const day = date.getDay();

  if (day === 0 || day === 6) return false;
  if (isUSMarketHoliday(date)) return false;

  return true;
};

/** Check if a date is a US stock market holiday. */
export const isUSMarketHoliday = (date: Date): boolean => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const dayOfWeek = date.getDay();

  if (month === 0 && day === 1) return true;
  if (month === 0 && day === 2 && dayOfWeek === 1) return true;
  if (month === 11 && day === 31 && dayOfWeek === 5) return true;
  if (month === 0 && dayOfWeek === 1 && day >= 15 && day <= 21) return true;
  if (month === 1 && dayOfWeek === 1 && day >= 15 && day <= 21) return true;

  const easterDate = getEasterDate(year);
  const goodFriday = new Date(easterDate);
  goodFriday.setDate(goodFriday.getDate() - 2);
  if (month === goodFriday.getMonth() && day === goodFriday.getDate()) {
    return true;
  }

  if (month === 4 && dayOfWeek === 1 && day >= 25) return true;
  if (month === 5 && day === 19) return true;
  if (month === 5 && day === 20 && dayOfWeek === 1) return true;
  if (month === 5 && day === 18 && dayOfWeek === 5) return true;
  if (month === 6 && day === 4) return true;
  if (month === 6 && day === 5 && dayOfWeek === 1) return true;
  if (month === 6 && day === 3 && dayOfWeek === 5) return true;
  if (month === 8 && dayOfWeek === 1 && day <= 7) return true;
  if (month === 10 && dayOfWeek === 4 && day >= 22 && day <= 28) return true;
  if (month === 11 && day === 25) return true;
  if (month === 11 && day === 26 && dayOfWeek === 1) return true;
  if (month === 11 && day === 24 && dayOfWeek === 5) return true;

  return false;
};

/** Calculate Easter Sunday using the Anonymous Gregorian algorithm. */
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
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
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

export const formatTradingDate = (date: Date): string =>
  date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

// ============================================================================
// DefiLlama Next.js data parsing
// ============================================================================

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`Invalid ETF data: ${field} must be an object`);
  }
  return value;
};

const getFiniteNumber = (
  record: Record<string, unknown>,
  field: string,
): number => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createETFRequestError(
      `Invalid ETF data: ${field} must be a finite number`,
      false,
    );
  }
  return value;
};

const validateTimestamp = (timestamp: number, field: string): void => {
  const maximum = Math.floor(Date.now() / 1000) + MAX_FUTURE_SKEW_SECONDS;
  if (
    !Number.isInteger(timestamp) ||
    timestamp < MIN_FLOW_TIMESTAMP ||
    timestamp > maximum
  ) {
    throw new Error(
      `Invalid ETF data: ${field} must be a plausible Unix timestamp in seconds`,
    );
  }
};

const parseFlowRecord = (value: unknown): ETFFlowRecord => {
  const record = getRecord(value, "flow record");
  const timestamp = getFiniteNumber(record, "date");
  validateTimestamp(timestamp, "date");

  return {
    timestamp,
    bitcoinUsd: getFiniteNumber(record, "Bitcoin"),
    ethereumUsd: getFiniteNumber(record, "Ethereum"),
    solanaUsd: getFiniteNumber(record, "Solana"),
  };
};

export const parseETFFlowPage = (html: string): ETFFlowRecord => {
  const $ = cheerio.load(html);
  const nextDataText = $("script#__NEXT_DATA__").first().text().trim();
  if (!nextDataText) {
    throw new Error("Invalid ETF page: __NEXT_DATA__ script not found");
  }

  let nextData: unknown;
  try {
    nextData = JSON.parse(nextDataText) as unknown;
  } catch {
    throw new Error("Invalid ETF page: __NEXT_DATA__ is not valid JSON");
  }

  const root = getRecord(nextData, "__NEXT_DATA__");
  const props = getRecord(root["props"], "props");
  const pageProps = getRecord(props["pageProps"], "pageProps");
  const flows = getRecord(pageProps["flows"], "flows");

  let latestEntry: readonly [timestamp: number, value: unknown] | undefined;
  for (const [key, value] of Object.entries(flows)) {
    const timestamp = Number(key);
    validateTimestamp(timestamp, "flow key");
    if (latestEntry === undefined || timestamp > latestEntry[0]) {
      latestEntry = [timestamp, value];
    }
  }
  if (latestEntry === undefined) {
    throw new Error("Invalid ETF data: flows must contain at least one record");
  }

  const latest = parseFlowRecord(latestEntry[1]);
  if (latest.timestamp !== latestEntry[0]) {
    throw new Error("Invalid ETF data: flow key does not match record date");
  }

  return latest;
};

const isETFRequestError = (error: unknown): error is ETFRequestError =>
  error instanceof Error &&
  "retryable" in error &&
  typeof error.retryable === "boolean";

export const readETFFlowResponseBody = async (
  response: Response,
): Promise<string> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw createETFRequestError("ETF data response exceeds 5 MiB", false);
  }
  const reader = (
    response.body as ReadableStream<Uint8Array>
  ).getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    let result = await reader.read();
    while (!result.done) {
      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw createETFRequestError("ETF data response exceeds 5 MiB", false);
      }
      text += decoder.decode(result.value, { stream: true });
      result = await reader.read();
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
};

export const shouldRetryETFFlowFetch = (error: unknown): boolean => {
  if (isETFRequestError(error)) return error.retryable;
  if (error instanceof TypeError) return true;
  return error instanceof DOMException && error.name === "TimeoutError";
};

export const isRetryableETFStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

const fetchETFFlowPage = async (): Promise<ETFFlowRecord> => {
  const response = await fetch(DEFILLAMA_ETF_URL, {
    headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw createETFRequestError(
      `ETF data request failed with HTTP ${response.status}`,
      isRetryableETFStatus(response.status),
    );
  }
  return parseETFFlowPage(await readETFFlowResponseBody(response));
};

const fetchETFFlows = async (): Promise<ETFFlowRecord> => {
  const today = new Date().toISOString().split("T")[0];
  return withCache(
    `etf-flows-${today}`,
    () =>
      backOff(fetchETFFlowPage, {
        numOfAttempts: 3,
        startingDelay: 1000,
        timeMultiple: 2,
        jitter: "full",
        retry: shouldRetryETFFlowFetch,
      }),
    { ttlMs: CACHE_TTL_MS },
  );
};

// ============================================================================
// Formatting and source
// ============================================================================

export const formatMillion = (value: number): string => {
  if (value === 0) return "$0";
  const absValue = Math.abs(value).toFixed(1);
  if (value > 0) return `+$${absValue}M`;
  return `-$${absValue}M`;
};

const buildETFItem = (
  type: "BTC" | "ETH" | "SOL",
  usd: number,
  url: string,
) => {
  const millions = usd / 1_000_000;
  return {
    text: `${type} ETFs: ${formatMillion(millions)}`,
    sentiment: getFlowSentiment(millions),
    url,
  } as const;
};

export const etfFlowsSource: DataSource = {
  name: "ETF Flows",
  priority: 3,
  timeoutMs: 90_000,

  fetch: async (): Promise<BriefingSection> => {
    console.log(
      `[etf-flows] Fetching aggregate flows from ${DEFILLAMA_ETF_URL}`,
    );
    const record = await fetchETFFlows();

    return {
      title: `ETF Flows from ${formatTradingDate(new Date(record.timestamp * 1000))}`,
      icon: "📊",
      items: [
        buildETFItem("BTC", record.bitcoinUsd, BTC_ETF_URL),
        buildETFItem("ETH", record.ethereumUsd, ETH_ETF_URL),
        buildETFItem("SOL", record.solanaUsd, SOL_ETF_URL),
      ],
    };
  },
};

export const mockETFFlowsSource: DataSource = {
  name: "ETF Flows",
  priority: 3,

  fetch: async (date: Date): Promise<BriefingSection> => {
    const tradingDate = getPreviousTradingDay(date);
    return {
      title: `ETF Flows from ${formatTradingDate(tradingDate)}`,
      icon: "📊",
      items: [
        buildETFItem("BTC", 145_200_000, BTC_ETF_URL),
        buildETFItem("ETH", -23_100_000, ETH_ETF_URL),
        buildETFItem("SOL", 18_700_000, SOL_ETF_URL),
      ],
    };
  },
};
