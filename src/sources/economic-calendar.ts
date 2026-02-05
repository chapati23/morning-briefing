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
    const events = await fetchHighImportanceEvents(date);

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
// Briefing Item Creation
// ============================================================================

/**
 * Create a BriefingItem with a Google Calendar link for one-tap event creation.
 */
const createBriefingItem = (event: TradingViewEvent): BriefingItem => {
  const eventUrl = buildTradingViewUrl(event);
  const detail = formatEventDetail(event);
  const eventDate = new Date(event.date);
  const calendarUrl = buildGoogleCalendarUrl(event, eventDate);

  return {
    text: formatEventText(event),
    detail,
    sentiment: "neutral" as const,
    time: eventDate,
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
// API Client
// ============================================================================

interface TradingViewEvent {
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
  date: Date,
): Promise<readonly TradingViewEvent[]> => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const url = new URL(TRADINGVIEW_API_URL);
  url.searchParams.set("from", startOfDay.toISOString());
  url.searchParams.set("to", endOfDay.toISOString());
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

const formatEventText = (event: TradingViewEvent): string => {
  const flag = COUNTRY_FLAGS.get(event.country) ?? "🌍";
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
