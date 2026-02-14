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
import {
  formatDateKey,
  loadRankingsHistory,
  saveRankingsHistory,
} from "../utils";
import type { DailyAppRanking, DailySnapshot, RankingsHistory } from "../utils";

// ============================================================================
// Tracked Apps Configuration
// ============================================================================

interface TrackedApp {
  readonly name: string;
  readonly bundleId: string;
  /** iTunes track ID for matching against Apple RSS API results */
  readonly itunesId: string;
}

const TRACKED_APPS: readonly TrackedApp[] = [
  { name: "Coinbase", bundleId: "com.vilcsak.bitcoin2", itunesId: "886427730" },
  {
    name: "Polymarket",
    bundleId: "com.polymarket.ios-app",
    itunesId: "6450037961",
  },
  { name: "Kraken", bundleId: "com.kraken.invest.app", itunesId: "1481947260" },
  { name: "Crypto.com", bundleId: "co.mona.Monaco", itunesId: "1262148500" },
];

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
const fetchOverallRankings = async (): Promise<ReadonlyMap<string, number>> => {
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
const fetchFinanceRankings = async (): Promise<ReadonlyMap<string, number>> => {
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

/** Fetch current rankings for all tracked apps from both sources in parallel. */
const fetchCurrentRankings = async (): Promise<DailySnapshot> => {
  const [overallResult, financeResult] = await Promise.allSettled([
    fetchOverallRankings(),
    fetchFinanceRankings(),
  ]);

  const overallMap =
    overallResult.status === "fulfilled" ? overallResult.value : null;
  const financeMap =
    financeResult.status === "fulfilled" ? financeResult.value : null;

  if (overallResult.status === "rejected") {
    console.warn(
      "[appstore-rankings] Overall rankings fetch failed:",
      overallResult.reason instanceof Error
        ? overallResult.reason.message
        : overallResult.reason,
    );
  }
  if (financeResult.status === "rejected") {
    console.warn(
      "[appstore-rankings] Finance rankings fetch failed:",
      financeResult.reason instanceof Error
        ? financeResult.reason.message
        : financeResult.reason,
    );
  }

  // If both failed, throw
  if (!overallMap && !financeMap) {
    throw new Error("Both ranking sources failed");
  }

  const snapshot: Record<string, DailyAppRanking> = {};
  for (const app of TRACKED_APPS) {
    snapshot[app.bundleId] = {
      overall: overallMap?.get(app.itunesId) ?? null,
      finance: financeMap?.get(app.bundleId) ?? null,
    };
  }

  return snapshot;
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

/** Format a rank number for display (e.g., "#35" or "unranked"). */
const formatRank = (rank: number | null): string =>
  rank === null ? "unranked" : `#${rank}`;

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

/** Format the position text for a single app (e.g., "#35 overall · #12 Finance"). */
export const formatPositionText = (
  app: TrackedApp,
  ranking: DailyAppRanking,
): string => {
  const parts: string[] = [app.name];

  if (ranking.overall === null && ranking.finance === null) {
    parts.push("unranked");
  } else if (ranking.overall !== null && ranking.finance !== null) {
    parts.push(
      `${formatRank(ranking.overall)} overall · ${formatRank(ranking.finance)} Finance`,
    );
  } else if (ranking.finance === null) {
    parts.push(`${formatRank(ranking.overall)} overall`);
  } else {
    parts.push(`${formatRank(ranking.finance)} Finance`);
  }

  return parts.join(": ");
};

/** Build BriefingItems from current rankings + historical trends. */
const buildBriefingItems = (
  snapshot: DailySnapshot,
  history: RankingsHistory,
  referenceDate: Date,
): readonly BriefingItem[] =>
  TRACKED_APPS.map((app) => {
    const ranking = snapshot[app.bundleId] ?? { overall: null, finance: null };
    const trends = computeAppTrends(
      history,
      ranking.finance,
      app.bundleId,
      referenceDate,
    );

    return {
      text: formatPositionText(app, ranking),
      detail: formatTrendLine(trends),
      sentiment: getSentiment(trends),
    };
  });

// ============================================================================
// Data Source
// ============================================================================

export const appStoreRankingsSource: DataSource = {
  name: "App Store Rankings",
  priority: 7,
  timeoutMs: 30_000,

  fetch: async (): Promise<BriefingSection> => {
    console.log("[appstore-rankings] Starting App Store rankings fetch...");

    // Fetch current rankings from both APIs
    const snapshot = await fetchCurrentRankings();

    // Load historical data
    const history = await loadRankingsHistory();

    // Build items with trend data from history
    const today = new Date();
    const items = buildBriefingItems(snapshot, history, today);

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

    return {
      title: "App Store Rankings",
      icon: "📱",
      items,
    };
  },
};

// ============================================================================
// Mock Data for Testing
// ============================================================================

export const mockAppStoreRankingsSource: DataSource = {
  name: "App Store Rankings",
  priority: 7,

  fetch: async (): Promise<BriefingSection> => ({
    title: "App Store Rankings",
    icon: "📱",
    items: [
      {
        text: "Coinbase: #35 overall · #12 Finance",
        detail: "↑5 daily · ↑12 weekly · ↑25 monthly",
        sentiment: "positive",
      },
      {
        text: "Polymarket: #128 Finance",
        detail: "↓46 daily · ↓42 weekly",
        sentiment: "negative",
      },
      {
        text: "Kraken: unranked",
      },
      {
        text: "Crypto.com: unranked",
      },
    ],
  }),
};
