/**
 * Economic Calendar Data Source
 *
 * Fetches high-importance economic events from TradingView's Economic Calendar API.
 * https://www.tradingview.com/economic-calendar/
 *
 * Pre-generates ICS calendar files and uploads them to GCS for instant downloads.
 */

import type { BriefingItem, BriefingSection, DataSource } from "../types";
import {
  generateIcsContent,
  getIcsPath,
  uploadIcsFile,
  type IcsEventParams,
} from "../utils";

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

    // Generate ICS files and upload to GCS in parallel
    const items = await Promise.all(
      events.map((event) => createBriefingItemWithCalendar(event, date)),
    );

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
// ICS Generation & Upload
// ============================================================================

/**
 * Check if GCS is configured for ICS file uploads.
 */
const isGcsConfigured = (): boolean => {
  return Boolean(process.env["GCS_BUCKET"]);
};

/**
 * Create a BriefingItem with a pre-generated ICS file uploaded to GCS.
 * Falls back gracefully if GCS is not configured (e.g., local development).
 */
const createBriefingItemWithCalendar = async (
  event: TradingViewEvent,
  briefingDate: Date,
): Promise<BriefingItem> => {
  const eventUrl = buildTradingViewUrl(event);
  const detail = formatEventDetail(event);

  // Try to upload ICS to GCS if configured
  let calendarUrl: string | undefined;
  if (isGcsConfigured()) {
    try {
      const icsParams: IcsEventParams = {
        id: event.id,
        title: event.title,
        date: event.date,
        description: detail ? `${detail}\n\nDetails: ${eventUrl}` : eventUrl,
        url: eventUrl,
      };
      const icsContent = generateIcsContent(icsParams);
      const gcsPath = getIcsPath(briefingDate, event.id);
      calendarUrl = await uploadIcsFile(icsContent, gcsPath);
    } catch (error) {
      // Log but don't fail - calendar links are nice-to-have
      console.warn(
        `[economic-calendar] Failed to upload ICS for ${event.id}:`,
        error,
      );
    }
  }

  return {
    text: formatEventText(event),
    detail,
    sentiment: "neutral" as const,
    time: new Date(event.date),
    url: eventUrl,
    calendarUrl,
  };
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
    parts.push(`Actual: ${formatValue(event.actual, event.unit, event.scale)}`);
  }

  if (event.forecast !== null) {
    parts.push(
      `Forecast: ${formatValue(event.forecast, event.unit, event.scale)}`,
    );
  }

  if (event.previous !== null) {
    parts.push(
      `Previous: ${formatValue(event.previous, event.unit, event.scale)}`,
    );
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

/**
 * Build the TradingView economic calendar URL with event ID.
 */
const buildTradingViewUrl = (event: TradingViewEvent): string => {
  const url = new URL("https://www.tradingview.com/economic-calendar/");
  url.searchParams.set("event", event.id);
  return url.toString();
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
        detail: "Forecast: 180K | Previous: 227K",
        sentiment: "neutral",
        url: "https://www.tradingview.com/economic-calendar/",
      },
      {
        text: "10:00 AM EST: 🇺🇸 ISM Manufacturing PMI",
        detail: "Forecast: 48.2 | Previous: 48.4",
        sentiment: "neutral",
        url: "https://www.tradingview.com/economic-calendar/",
      },
    ],
  }),
};
