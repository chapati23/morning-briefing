/**
 * App Store Rankings Data Source
 *
 * Tracks iOS App Store positions (overall + Finance category) for crypto apps.
 * Uses two free Apple APIs (no dependencies, no API keys):
 *   1. Apple Marketing Tools RSS API → overall US top 100
 *   2. iTunes RSS feed (legacy Apple endpoint, still active as of 2026) → Finance category top 200
 *
 * Historical data is persisted in GCS (production) or local cache (dev)
 * to compute daily/weekly/monthly trend indicators.
 */

import type {
  BriefingItem,
  BriefingSection,
  DataSource,
  Sentiment,
} from "../types";
import type { DailySnapshot, RankingsHistory } from "../utils";
import {
  formatDateKey,
  loadRankingsHistory,
  saveRankingsHistory,
} from "../utils";
import { fetchCurrentRankings } from "./fetch-current-rankings";
import { TRACKED_APPS } from "./tracked-apps";

// ============================================================================
// Tracked Apps Configuration
// ============================================================================

export interface TrackedApp {
  readonly name: string;
  readonly bundleId: string;
  /** iTunes track ID for matching against Apple RSS API results */
  readonly itunesId: string;
}

// ============================================================================
// Apple API Types
// ============================================================================

/** Response from Apple Marketing Tools RSS API (overall charts) */
interface AppleRSSResponse {
  readonly feed: {
    readonly results: readonly AppleRSSApp[];
  };
}

interface AppleRSSApp {
  readonly id: string;
  readonly name: string;
}

/** Response from legacy iTunes RSS feed (category charts) */
interface ITunesRSSResponse {
  readonly feed: {
    readonly entry?: readonly ITunesRSSEntry[];
  };
}

interface ITunesRSSEntry {
  readonly id: {
    readonly attributes: {
      readonly "im:id": string;
      readonly "im:bundleId": string;
    };
  };
  readonly "im:name": {
    readonly label: string;
  };
}

// ============================================================================
// Data Fetching
// ============================================================================

const APPLE_RSS_URL =
  "https://rss.applemarketingtools.com/api/v2/us/apps/top-free/100/apps.json";

/** Genre ID for Finance category in the App Store */
const FINANCE_GENRE_ID = 6015;

/**
 * Build the iTunes RSS feed URL for a category chart.
 * Uses the itunes.apple.com hostname which supports HTTPS
 * (the legacy ax.itunes.apple.com hostname lacks a valid TLS certificate).
 */
const buildITunesRSSUrl = (genre: number, limit: number): string =>
  `https://itunes.apple.com/us/rss/topfreeapplications/genre=${genre}/limit=${limit}/json`;

/** Fetch overall US App Store top 100 from Apple's RSS API. Returns Map<itunesId, rank>. */
export const fetchOverallRankings = async (): Promise<
  ReadonlyMap<string, number>
> => {
  console.log(
    "[appstore-rankings] Fetching overall rankings from Apple RSS API...",
  );

  const response = await fetch(APPLE_RSS_URL);
  if (!response.ok) {
    throw new Error(
      `Apple RSS API returned ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as AppleRSSResponse;
  const rankings = new Map<string, number>();

  for (const [index, app] of data.feed.results.entries()) {
    rankings.set(app.id, index + 1); // 1-indexed rank
  }

  console.log(`[appstore-rankings] Got ${rankings.size} overall rankings`);
  return rankings;
};

/** Fetch Finance category top 200 from iTunes RSS feed. Returns Map<bundleId, rank>. */
export const fetchFinanceRankings = async (): Promise<
  ReadonlyMap<string, number>
> => {
  console.log("[appstore-rankings] Fetching Finance category rankings...");

  const url = buildITunesRSSUrl(FINANCE_GENRE_ID, 200);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `iTunes RSS feed returned ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as ITunesRSSResponse;
  const entries = data.feed.entry ?? [];

  const rankings = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    rankings.set(entry.id.attributes["im:bundleId"], index + 1); // 1-indexed rank
  }

  console.log(`[appstore-rankings] Got ${rankings.size} Finance rankings`);
  return rankings;
};

// ============================================================================
// Trend Calculation
// ============================================================================

interface RankTrend {
  /** Change in positions (positive = improved, negative = worsened) */
  readonly delta: number;
  /** Whether the app was previously unranked but is now ranked */
  readonly isNew: boolean;
  /** Whether the app was previously ranked but is now unranked */
  readonly isOut: boolean;
}

interface AppTrends {
  readonly daily: RankTrend | null;
  readonly weekly: RankTrend | null;
  readonly monthly: RankTrend | null;
}

/** Look up the ranking for a specific app on a specific date. */
const getRankOnDate = (
  history: RankingsHistory,
  dateKey: string,
  bundleId: string,
  field: "overall" | "finance",
): number | null | undefined => {
  const snapshot = history[dateKey];
  if (!snapshot) return undefined; // No data for that date
  const appData = snapshot[bundleId];
  if (!appData) return undefined;
  return appData[field];
};

/**
 * Compute the trend for a single (app, field) pair over a given number of days.
 * Returns null if no historical data is available for comparison.
 *
 * Exported for testing.
 */
export const computeTrend = (
  history: RankingsHistory,
  currentRank: number | null,
  bundleId: string,
  field: "overall" | "finance",
  daysAgo: number,
  referenceDate: Date,
): RankTrend | null => {
  const pastDate = new Date(referenceDate);
  pastDate.setDate(pastDate.getDate() - daysAgo);
  const pastDateKey = formatDateKey(pastDate);

  const pastRank = getRankOnDate(history, pastDateKey, bundleId, field);
  if (pastRank === undefined) return null; // No historical data

  // Both unranked → no meaningful trend
  if (pastRank === null && currentRank === null) return null;

  // Was unranked, now ranked → NEW
  if (pastRank === null && currentRank !== null) {
    return { delta: 0, isNew: true, isOut: false };
  }

  // Was ranked, now unranked → OUT
  if (pastRank !== null && currentRank === null) {
    return { delta: 0, isNew: false, isOut: true };
  }

  // Both ranked → compute delta (lower rank number = better, so past - current = improvement)
  // All null paths are exhausted above; explicit check satisfies the type checker
  if (pastRank !== null && currentRank !== null) {
    return { delta: pastRank - currentRank, isNew: false, isOut: false };
  }

  return null;
};

/** Compute daily/weekly/monthly trends for Finance category rank of a single app. */
const computeAppTrends = (
  history: RankingsHistory,
  currentRank: number | null,
  bundleId: string,
  referenceDate: Date,
): AppTrends => ({
  daily: computeTrend(
    history,
    currentRank,
    bundleId,
    "finance",
    1,
    referenceDate,
  ),
  weekly: computeTrend(
    history,
    currentRank,
    bundleId,
    "finance",
    7,
    referenceDate,
  ),
  monthly: computeTrend(
    history,
    currentRank,
    bundleId,
    "finance",
    30,
    referenceDate,
  ),
});

// ============================================================================
// Formatting (exported for testing)
// ============================================================================

/** Format a rank number for display (e.g., "#35" or "#101+"). */
const formatRank = (rank: number | null): string =>
  rank === null ? "#101+" : `#${rank}`;

/** Format a single trend indicator (e.g., "↑5", "↓3", "NEW", "OUT", "—"). */
export const formatTrendDelta = (trend: RankTrend): string => {
  if (trend.isNew) return "NEW";
  if (trend.isOut) return "OUT";
  if (trend.delta > 0) return `↑${trend.delta}`;
  if (trend.delta < 0) return `↓${Math.abs(trend.delta)}`;
  return "—";
};

/** Format the full trend line (e.g., "↑5 daily · ↓3 weekly · ↑12 monthly"). */
export const formatTrendLine = (trends: AppTrends): string | undefined => {
  const parts: string[] = [];

  if (trends.daily) parts.push(`${formatTrendDelta(trends.daily)} daily`);
  if (trends.weekly) parts.push(`${formatTrendDelta(trends.weekly)} weekly`);
  if (trends.monthly) parts.push(`${formatTrendDelta(trends.monthly)} monthly`);

  return parts.length > 0 ? parts.join(" · ") : undefined;
};

/** Determine sentiment from the 7-day Finance category trend. */
export const getSentiment = (trends: AppTrends): Sentiment | undefined => {
  const trend = trends.weekly ?? trends.daily;
  if (!trend) return undefined;
  if (trend.isNew) return "positive";
  if (trend.isOut) return "negative";
  if (trend.delta > 0) return "positive";
  if (trend.delta < 0) return "negative";
  return "neutral";
};

/** Format the position text for a Finance-section item (rank only, no "Finance" label). */
export const formatFinancePositionText = (
  app: TrackedApp,
  rank: number,
): string => `${app.name}: ${formatRank(rank)}`;

/** Format the position text for a Total-section item (rank only, no "overall" label). */
export const formatOverallPositionText = (
  app: TrackedApp,
  rank: number,
): string => `${app.name}: ${formatRank(rank)}`;

/** Compute daily/weekly/monthly trends for Overall rank of a single app. */
const computeOverallAppTrends = (
  history: RankingsHistory,
  currentRank: number | null,
  bundleId: string,
  referenceDate: Date,
): AppTrends => ({
  daily: computeTrend(
    history,
    currentRank,
    bundleId,
    "overall",
    1,
    referenceDate,
  ),
  weekly: computeTrend(
    history,
    currentRank,
    bundleId,
    "overall",
    7,
    referenceDate,
  ),
  monthly: computeTrend(
    history,
    currentRank,
    bundleId,
    "overall",
    30,
    referenceDate,
  ),
});

/** Build Finance-category BriefingItems — all tracked apps, sorted by rank. */
const buildFinanceItems = (
  snapshot: DailySnapshot,
  history: RankingsHistory,
  referenceDate: Date,
): readonly BriefingItem[] => {
  interface ItemWithRank {
    readonly rank: number;
    readonly item: BriefingItem;
  }

  return TRACKED_APPS.flatMap((app): ItemWithRank[] => {
    const ranking = snapshot[app.bundleId] ?? { overall: null, finance: null };

    // Include all apps — ranked or unranked (rank 101+)
    const rank = ranking.finance ?? 101;
    const trends = computeAppTrends(
      history,
      ranking.finance,
      app.bundleId,
      referenceDate,
    );
    const trendLine = formatTrendLine(trends);
    const text = trendLine
      ? `${formatFinancePositionText(app, rank)} (${trendLine})`
      : formatFinancePositionText(app, rank);

    return [
      {
        rank,
        item: { text, sentiment: getSentiment(trends), sentimentPrefix: true },
      },
    ];
  })
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
};

/** Build Overall/Total BriefingItems — only apps ranked in the overall top 100, sorted by rank. */
const buildOverallItems = (
  snapshot: DailySnapshot,
  history: RankingsHistory,
  referenceDate: Date,
): readonly BriefingItem[] => {
  interface ItemWithRank {
    readonly rank: number;
    readonly item: BriefingItem;
  }

  return TRACKED_APPS.flatMap((app): ItemWithRank[] => {
    const ranking = snapshot[app.bundleId] ?? { overall: null, finance: null };
    if (ranking.overall === null) return [];

    const trends = computeOverallAppTrends(
      history,
      ranking.overall,
      app.bundleId,
      referenceDate,
    );
    const trendLine = formatTrendLine(trends);
    const text = trendLine
      ? `${formatOverallPositionText(app, ranking.overall)} (${trendLine})`
      : formatOverallPositionText(app, ranking.overall);

    return [
      {
        rank: ranking.overall,
        item: { text, sentiment: getSentiment(trends), sentimentPrefix: true },
      },
    ];
  })
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
};

// ============================================================================
// Data Source
// ============================================================================

export const appStoreRankingsSource: DataSource = {
  name: "App Store Rankings",
  priority: 7,
  timeoutMs: 30_000,

  fetch: async (): Promise<BriefingSection[]> => {
    console.log("[appstore-rankings] Starting App Store rankings fetch...");

    // Fetch current rankings from both APIs
    const snapshot = await fetchCurrentRankings();

    // Load historical data
    const history = await loadRankingsHistory();

    // Build items with trend data from history
    const today = new Date();
    const financeItems = buildFinanceItems(snapshot, history, today);
    const overallItems = buildOverallItems(snapshot, history, today);

    // Save today's snapshot to history (for future trend calculations).
    // Failure to save is non-fatal: the current briefing data is still valid,
    // we just won't have today's snapshot for tomorrow's trend comparison.
    const todayKey = formatDateKey(today);
    const updatedHistory: Record<string, DailySnapshot> = { ...history };
    updatedHistory[todayKey] = snapshot;
    try {
      await saveRankingsHistory(updatedHistory);
      console.log("[appstore-rankings] Done. Saved snapshot for", todayKey);
    } catch (error) {
      console.warn(
        "[appstore-rankings] Failed to save history (non-fatal):",
        error instanceof Error ? error.message : error,
      );
    }

    const sections: BriefingSection[] = [
      {
        title: "App Store · Finance",
        icon: "📱",
        items: financeItems,
      },
    ];

    // Only include Total section if at least one app cracked the overall top 100
    if (overallItems.length > 0) {
      sections.push({
        title: "App Store · Total",
        icon: "📱",
        items: overallItems,
      });
    }

    return sections;
  },
};

// ============================================================================
// Mock Data for Testing
// ============================================================================

export const mockAppStoreRankingsSource: DataSource = {
  name: "App Store Rankings",
  priority: 7,

  fetch: async (): Promise<BriefingSection[]> => [
    {
      title: "App Store · Finance",
      icon: "📱",
      items: [
        {
          text: "Coinbase: #12 (↑5 daily · ↑12 weekly · ↑25 monthly)",
          sentiment: "positive",
        },
        {
          text: "Polymarket: #128 (↓46 daily · ↓42 weekly)",
          sentiment: "negative",
        },
      ],
    },
    {
      title: "App Store · Total",
      icon: "📱",
      items: [
        {
          text: "Coinbase: #35 (↑2 daily)",
          sentiment: "positive",
        },
      ],
    },
  ],
};
