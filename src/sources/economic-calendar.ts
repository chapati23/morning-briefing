/**
 * Economic Calendar Data Source
 *
 * Fetches high-importance economic events from TradingView's Economic Calendar API.
 * https://www.tradingview.com/economic-calendar/
 *
 * Includes Google Calendar links for one-tap event creation.
 */

import type { BriefingItem, BriefingSection, DataSource } from "../types";

const TRADINGVIEW_API_URL = "https://economic-calendar.tradingview.com/events";

/**
 * Major economies to track. These cover the most market-moving releases.
 */
const TRACKED_COUNTRIES = ["US", "GB", "EU", "DE", "JP", "CN"] as const;

/**
 * Country code to flag emoji mapping
 */
const COUNTRY_FLAGS: ReadonlyMap<string, string> = new Map([
  ["US", "🇺🇸"],
  ["GB", "🇬🇧"],
  ["EU", "🇪🇺"],
  ["DE", "🇩🇪"],
  ["JP", "🇯🇵"],
  ["CN", "🇨🇳"],
  ["CA", "🇨🇦"],
  ["AU", "🇦🇺"],
  ["CH", "🇨🇭"],
  ["FR", "🇫🇷"],
]);

// ============================================================================
// Data Source
// ============================================================================

export const economicCalendarSource: DataSource = {
  name: "Economic Calendar",
  priority: 4,

  fetch: async (date: Date): Promise<BriefingSection> => {
    if (isWeekend(date)) {
      return fetchWeekAhead(date);
    }

    const { start, end } = getDayRange(date);
    const events = await fetchHighImportanceEvents(start, end);
    const items = events.map((event) => createBriefingItem(event));

    return {
      title: "Economic Calendar",
      icon: "📅",
      items:
        items.length > 0
          ? items
          : [{ text: "No high-impact economic releases today" }],
    };
  },
};

// ============================================================================
// Week-Ahead Fetch (weekend path)
// ============================================================================

/**
 * Fetch the top market-moving events for the upcoming week.
 * Used when the briefing runs on a weekend.
 */
const fetchWeekAhead = async (date: Date): Promise<BriefingSection> => {
  const { start, end } = getNextWeekRange(date);
  const events = await fetchHighImportanceEvents(start, end);
  const topEvents = getTopEvents(events, WEEK_AHEAD_LIMIT);
  const items = topEvents.map((event) =>
    createBriefingItem(event, { includeWeekday: true }),
  );

  return {
    title: "Economic Calendar (Week Ahead)",
    icon: "📅",
    items:
      items.length > 0
        ? items
        : [{ text: "No high-impact economic releases next week" }],
  };
};

// ============================================================================
// Briefing Item Creation
// ============================================================================

interface BriefingItemOptions {
  readonly includeWeekday?: boolean;
}

/**
 * Create a BriefingItem with a Google Calendar link for one-tap event creation.
 * When `includeWeekday` is true, sets `timePrefix` to a short day name (e.g. "Wed")
 * so the formatter can render it inside the time link.
 */
const createBriefingItem = (
  event: TradingViewEvent,
  options: BriefingItemOptions = {},
): BriefingItem => {
  const eventUrl = buildTradingViewUrl(event);
  const detail = formatEventDetail(event);
  const eventDate = new Date(event.date);
  const calendarUrl = buildGoogleCalendarUrl(event, eventDate);

  return {
    text: formatEventText(event),
    detail,
    time: eventDate,
    timePrefix: options.includeWeekday ? formatWeekday(eventDate) : undefined,
    url: eventUrl,
    calendarUrl,
  };
};

/**
 * Build the TradingView economic calendar URL with event ID.
 */
const buildTradingViewUrl = (event: TradingViewEvent): string => {
  const url = new URL("https://www.tradingview.com/economic-calendar/");
  url.searchParams.set("event", event.id);
  return url.toString();
};

/**
 * Build a Google Calendar URL for adding an event.
 * Includes a link to TradingView in the event description for easy data lookup.
 */
const buildGoogleCalendarUrl = (
  event: TradingViewEvent,
  startDate: Date,
): string => {
  const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // +30 minutes
  const title = encodeURIComponent(event.title);
  const dates = `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`;
  const tradingViewUrl = buildTradingViewUrl(event);
  const details = encodeURIComponent(`View data: ${tradingViewUrl}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}`;
};

/**
 * Format a Date for Google Calendar URL (YYYYMMDDTHHMMSSZ format).
 */
const formatGoogleDate = (date: Date): string => {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
};

// ============================================================================
// Date Helpers
// ============================================================================

/**
 * Returns true if the given date falls on a Saturday (6) or Sunday (0).
 */
export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

/**
 * Returns the start (00:00:00.000) and end (23:59:59.999) of the given date.
 */
const getDayRange = (date: Date): { start: Date; end: Date } => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

/**
 * Given a weekend date, returns the date range for the next Monday through Friday.
 * Saturday → next Mon-Fri. Sunday → next Mon-Fri (same week).
 */
export const getNextWeekRange = (date: Date): { start: Date; end: Date } => {
  const day = date.getDay(); // 0 = Sun, 6 = Sat
  const daysUntilMonday = day === 6 ? 2 : 1; // Sat → +2, Sun → +1

  const monday = new Date(date);
  monday.setDate(monday.getDate() + daysUntilMonday);
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return { start: monday, end: friday };
};

// ============================================================================
// Event Ranking (for week-ahead view)
// ============================================================================

/** Maximum number of events to show in the week-ahead view. */
const WEEK_AHEAD_LIMIT = 5;

/**
 * Keyword-to-score map for known market-moving indicators.
 * Matched case-insensitively against event titles.
 *
 * Score 10: Central bank decisions and top-tier US employment/inflation data
 * Score 8:  GDP, core inflation proxies, major employment/retail figures
 * Score 6:  PMIs, sentiment surveys, housing, trade data
 * Score 4:  Default for any high-importance event not matching keywords
 */
const MARKET_IMPACT_INDICATORS: ReadonlyMap<string, number> = new Map([
  // Tier 1 — Score 10
  ["nonfarm payrolls", 10],
  ["consumer price index", 10],
  [" cpi", 10], // leading space avoids false matches like "recipe"
  ["interest rate decision", 10],
  ["fed funds rate", 10],
  ["fomc", 10],
  ["ecb interest rate", 10],
  ["boe interest rate", 10],
  ["boj interest rate", 10],

  // Tier 2 — Score 8
  ["gdp", 8],
  ["pce price index", 8],
  ["core pce", 8],
  ["ppi", 8],
  ["retail sales", 8],
  ["unemployment rate", 8],
  ["initial jobless claims", 8],

  // Tier 3 — Score 6
  ["pmi", 6],
  ["ism manufacturing", 6],
  ["ism services", 6],
  ["consumer confidence", 6],
  ["trade balance", 6],
  ["housing starts", 6],
  ["building permits", 6],
  ["durable goods", 6],
  ["industrial production", 6],
]);

/**
 * Country weighting — US data moves global markets the most.
 */
const COUNTRY_WEIGHT: ReadonlyMap<string, number> = new Map([
  ["US", 1.5],
  ["EU", 1.2],
  ["GB", 1.2],
  ["DE", 1.1],
  ["JP", 1],
  ["CN", 1],
]);

const DEFAULT_INDICATOR_SCORE = 4;
const DEFAULT_COUNTRY_WEIGHT = 1;

/**
 * Compute a market-impact score for a single event.
 * Higher score = more likely to move markets.
 */
export const scoreEvent = (event: TradingViewEvent): number => {
  const titleLower = event.title.toLowerCase();

  let indicatorScore = DEFAULT_INDICATOR_SCORE;
  for (const [keyword, score] of MARKET_IMPACT_INDICATORS) {
    if (titleLower.includes(keyword)) {
      indicatorScore = Math.max(indicatorScore, score);
    }
  }

  const countryWeight =
    COUNTRY_WEIGHT.get(event.country) ?? DEFAULT_COUNTRY_WEIGHT;

  return indicatorScore * countryWeight;
};

/**
 * Score, rank, and return the top N events.
 * Tiebreaker: chronological order (earlier first).
 */
export const getTopEvents = (
  events: readonly TradingViewEvent[],
  limit: number,
): readonly TradingViewEvent[] =>
  [...events]
    .sort((a, b) => {
      const scoreDiff = scoreEvent(b) - scoreEvent(a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.date.localeCompare(b.date);
    })
    .slice(0, limit);

// ============================================================================
// API Client
// ============================================================================

export interface TradingViewEvent {
  readonly id: string;
  readonly title: string;
  readonly country: string;
  readonly indicator: string;
  readonly ticker?: string;
  readonly comment?: string;
  readonly category?: string;
  readonly period?: string;
  readonly date: string;
  readonly actual: number | null;
  readonly forecast: number | null;
  readonly previous: number | null;
  readonly importance: -1 | 0 | 1;
  readonly currency?: string;
  readonly unit?: string;
  readonly scale?: string;
  readonly source?: string;
  readonly source_url?: string;
}

interface TradingViewResponse {
  readonly status: string;
  readonly result: readonly TradingViewEvent[];
}

const fetchHighImportanceEvents = async (
  from: Date,
  to: Date,
): Promise<readonly TradingViewEvent[]> => {
  const url = new URL(TRADINGVIEW_API_URL);
  url.searchParams.set("from", from.toISOString());
  url.searchParams.set("to", to.toISOString());
  url.searchParams.set("countries", TRACKED_COUNTRIES.join(","));

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json",
      Origin: "https://www.tradingview.com",
      Referer: "https://www.tradingview.com/economic-calendar/",
    },
  });

  if (!response.ok) {
    throw new Error(
      `TradingView API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as TradingViewResponse;

  if (data.status !== "ok") {
    throw new Error(`TradingView API returned status: ${data.status}`);
  }

  // Filter to high-importance events only (importance === 1)
  const highImportanceEvents = data.result.filter(
    (event) => event.importance === 1,
  );

  // Sort by date (earliest first)
  return [...highImportanceEvents].sort((a, b) => a.date.localeCompare(b.date));
};

// ============================================================================
// Formatters
// ============================================================================

const WEEKDAY_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/**
 * Format a short weekday name for the week-ahead view (e.g. "Mon", "Tue").
 */
const formatWeekday = (date: Date): string =>
  WEEKDAY_NAMES[date.getDay()] ?? "???";

/**
 * Resolve the effective country for an event, correcting known data-quality issues.
 *
 * TradingView assigns country="GB" to S&P Global PMI Flash events because S&P Global
 * (formerly IHS Markit) is headquartered in the UK — even when the event measures the
 * US economy.  If the title doesn't explicitly reference UK / United Kingdom, treat it
 * as a US reading.
 */
export const getEffectiveCountry = (event: TradingViewEvent): string => {
  if (
    event.country === "GB" &&
    /^s&p global\b/i.test(event.title) &&
    !/\b(uk|united kingdom|britain|british)\b/i.test(event.title)
  ) {
    return "US";
  }
  return event.country;
};

const formatEventText = (event: TradingViewEvent): string => {
  const country = getEffectiveCountry(event);
  const flag = COUNTRY_FLAGS.get(country) ?? "🌍";
  return `${flag} ${event.title}`;
};

const formatEventDetail = (event: TradingViewEvent): string | undefined => {
  const parts: string[] = [];

  if (event.actual !== null) {
    parts.push(`Act: ${formatValue(event.actual, event.unit, event.scale)}`);
  }

  if (event.forecast !== null) {
    parts.push(`Fcst: ${formatValue(event.forecast, event.unit, event.scale)}`);
  }

  if (event.previous !== null) {
    parts.push(`Prev: ${formatValue(event.previous, event.unit, event.scale)}`);
  }

  return parts.length > 0 ? parts.join(" | ") : undefined;
};

const formatValue = (value: number, unit?: string, scale?: string): string => {
  const scaleLabel = scale ? ` ${scale}` : "";
  const unitLabel = unit ?? "";

  // Format number with appropriate precision
  const formatted = getFormattedPrecision(value);

  return `${formatted}${unitLabel}${scaleLabel}`;
};

const getFormattedPrecision = (value: number): string => {
  const absValue = Math.abs(value);
  if (absValue >= 100) return value.toFixed(0);
  if (absValue >= 1) return value.toFixed(1);
  return value.toFixed(2);
};

// ============================================================================
// Mock Data for Testing
// ============================================================================

export const mockEconomicCalendarSource: DataSource = {
  name: "Economic Calendar",
  priority: 4,

  fetch: async (): Promise<BriefingSection> => ({
    title: "Economic Calendar",
    icon: "📅",
    items: [
      {
        text: "8:30 AM EST: 🇺🇸 Nonfarm Payrolls",
        detail: "Fcst: 180K | Prev: 227K",
        sentiment: "neutral",
        url: "https://www.tradingview.com/economic-calendar/",
      },
      {
        text: "10:00 AM EST: 🇺🇸 ISM Manufacturing PMI",
        detail: "Fcst: 48.2 | Prev: 48.4",
        sentiment: "neutral",
        url: "https://www.tradingview.com/economic-calendar/",
      },
    ],
  }),
};
